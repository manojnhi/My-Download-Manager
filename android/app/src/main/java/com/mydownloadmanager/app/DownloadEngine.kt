package com.mydownloadmanager.app

import android.content.Context
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

data class DownloadJobState(
    val id: String,
    val url: String,
    val filename: String,
    val category: FileCategory,
    val destinationFile: File,
    val partFile: File,
    val status: DownloadStatus = DownloadStatus.QUEUED,
    val totalBytes: Long? = null,
    val downloadedBytes: Long = 0L,
    val speedBytesPerSec: Long = 0L,
    val resumable: Boolean = false,
    val connectionsUsed: Int = 1,
    val segments: List<SegmentPlan> = emptyList(),
    val error: String? = null,
    val warning: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

data class ManagerSettings(
    val maxConcurrent: Int = 3,
    val connectionsPerDownload: Int = 4,
    val speedLimitKBps: Int = 0,
    val organizeByCategory: Boolean = true,
    val darkMode: Boolean = false
)

class DownloadEngine(private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    private val jobsMap = ConcurrentHashMap<String, DownloadJobState>()
    private val activeTasks = ConcurrentHashMap<String, Job>()

    private val _jobs = MutableStateFlow<List<DownloadJobState>>(emptyList())
    val jobs: StateFlow<List<DownloadJobState>> = _jobs.asStateFlow()

    private val _settings = MutableStateFlow(ManagerSettings())
    val settings: StateFlow<ManagerSettings> = _settings.asStateFlow()

    fun updateSettings(updated: ManagerSettings) {
        _settings.value = updated.copy(
            maxConcurrent = updated.maxConcurrent.coerceIn(1, 6),
            connectionsPerDownload = updated.connectionsPerDownload.coerceIn(1, 16),
            speedLimitKBps = updated.speedLimitKBps.coerceAtLeast(0)
        )
        scheduleNext()
    }

    fun enqueue(url: String): DownloadJobState {
        val inspection = DownloadCore.inspectUrl(url)
        val baseDir = File(context.getExternalFilesDir(null), "MyDownloadManager")
        val targetDir = if (_settings.value.organizeByCategory) {
            File(baseDir, inspection.category.defaultFolder)
        } else baseDir
        targetDir.mkdirs()

        val destFile = File(targetDir, inspection.filename)
        val partFile = File(targetDir, "${inspection.filename}.part")
        val job = DownloadJobState(
            id = UUID.randomUUID().toString(),
            url = inspection.normalizedUrl,
            filename = inspection.filename,
            category = inspection.category,
            destinationFile = destFile,
            partFile = partFile,
            warning = if (!inspection.isHttps) "Unencrypted HTTP connection." else null
        )
        jobsMap[job.id] = job
        publish()
        scheduleNext()
        return job
    }

    fun pause(id: String) {
        activeTasks.remove(id)?.cancel()
        jobsMap[id]?.let {
            jobsMap[id] = it.copy(status = DownloadStatus.PAUSED, speedBytesPerSec = 0L)
        }
        publish()
        scheduleNext()
    }

    fun resume(id: String) {
        jobsMap[id]?.let {
            val resetIfNonResumable = if (!it.resumable) {
                it.partFile.delete()
                it.copy(status = DownloadStatus.QUEUED, downloadedBytes = 0L, segments = emptyList(), error = null)
            } else {
                it.copy(status = DownloadStatus.QUEUED, error = null)
            }
            jobsMap[id] = resetIfNonResumable
        }
        publish()
        scheduleNext()
    }

    fun cancel(id: String) {
        activeTasks.remove(id)?.cancel()
        jobsMap[id]?.let {
            it.partFile.delete()
            jobsMap[id] = it.copy(status = DownloadStatus.CANCELED, speedBytesPerSec = 0L)
        }
        publish()
        scheduleNext()
    }

    fun remove(id: String) {
        activeTasks.remove(id)?.cancel()
        jobsMap.remove(id)?.let {
            if (it.status != DownloadStatus.COMPLETED) it.partFile.delete()
        }
        publish()
        scheduleNext()
    }

    private fun scheduleNext() {
        val ordered = jobsMap.values.sortedBy { it.createdAt }.map { it.id to it.status }
        val toStart = DownloadCore.selectJobsToStart(ordered, _settings.value.maxConcurrent)
        for (id in toStart) {
            startJob(id)
        }
    }

    private fun startJob(id: String) {
        val current = jobsMap[id] ?: return
        if (activeTasks.containsKey(id)) return

        activeTasks[id] = scope.launch {
            try {
                jobsMap[id] = current.copy(status = DownloadStatus.PROBING, error = null)
                publish()

                var state = jobsMap[id] ?: return@launch
                if (!state.resumable || state.segments.isEmpty() || !state.partFile.exists()) {
                    val probeReq = Request.Builder().url(state.url).head().build()
                    val headResp = client.newCall(probeReq).execute()
                    val code = headResp.code
                    val totalLen = headResp.header("Content-Length")?.toLongOrNull()
                    val acceptRanges = headResp.header("Accept-Ranges")?.contains("bytes", ignoreCase = true) == true &&
                        totalLen != null && totalLen > 0L
                    headResp.close()

                    if (code !in 200..299 && code != 206) {
                        throw IllegalStateException(DownloadCore.mapHttpError(code))
                    }

                    val segments = DownloadCore.computeSegments(
                        totalLen,
                        _settings.value.connectionsPerDownload,
                        acceptRanges
                    )
                    RandomAccessFile(state.partFile, "rw").use { raf ->
                        if (totalLen != null && totalLen > 0) raf.setLength(totalLen)
                    }
                    state = state.copy(
                        totalBytes = totalLen,
                        resumable = acceptRanges,
                        segments = segments,
                        connectionsUsed = segments.size,
                        status = DownloadStatus.DOWNLOADING
                    )
                } else {
                    state = state.copy(status = DownloadStatus.DOWNLOADING)
                }

                jobsMap[id] = state
                publish()

                coroutineScope {
                    state.segments.filter { !it.completed }.map { seg ->
                        async { downloadSegment(id, seg) }
                    }.awaitAll()
                }

                val finished = jobsMap[id] ?: return@launch
                if (finished.destinationFile.exists()) finished.destinationFile.delete()
                finished.partFile.renameTo(finished.destinationFile)
                jobsMap[id] = finished.copy(
                    status = DownloadStatus.COMPLETED,
                    speedBytesPerSec = 0L
                )
            } catch (_: CancellationException) {
                // Paused or canceled cleanly
            } catch (e: Exception) {
                jobsMap[id]?.let {
                    jobsMap[id] = it.copy(
                        status = DownloadStatus.ERROR,
                        speedBytesPerSec = 0L,
                        error = e.message ?: "Download failed."
                    )
                }
            } finally {
                activeTasks.remove(id)
                publish()
                scheduleNext()
            }
        }
    }

    private suspend fun downloadSegment(jobId: String, seg: SegmentPlan) {
        val state = jobsMap[jobId] ?: return
        val offset = seg.startByte + seg.downloadedBytes
        val reqBuilder = Request.Builder().url(state.url)
        if (state.resumable && seg.endByte != null) {
            reqBuilder.addHeader("Range", "bytes=$offset-${seg.endByte}")
        }

        val response = client.newCall(reqBuilder.build()).execute()
        response.use { resp ->
            if (!resp.isSuccessful && resp.code != 206) {
                throw IllegalStateException(DownloadCore.mapHttpError(resp.code))
            }
            val body = resp.body ?: return
            val buf = ByteArray(16 * 1024)
            var writePos = offset
            RandomAccessFile(state.partFile, "rw").use { raf ->
                val stream = body.byteStream()
                while (currentCoroutineContext().isActive) {
                    val read = stream.read(buf)
                    if (read == -1) break
                    raf.seek(writePos)
                    raf.write(buf, 0, read)
                    writePos += read
                    seg.downloadedBytes += read

                    jobsMap[jobId]?.let { latest ->
                        val totalDl = latest.segments.sumOf { it.downloadedBytes }
                        jobsMap[jobId] = latest.copy(downloadedBytes = totalDl)
                        publish()
                    }
                }
            }
            seg.completed = true
        }
    }

    private fun publish() {
        _jobs.value = jobsMap.values.sortedByDescending { it.createdAt }
    }
}
