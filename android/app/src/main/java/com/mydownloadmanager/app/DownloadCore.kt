package com.mydownloadmanager.app

import java.net.URI

enum class FileCategory(val defaultFolder: String) {
    VIDEO("Videos"),
    AUDIO("Audio"),
    IMAGE("Images"),
    DOCUMENT("Documents"),
    ARCHIVE("Archives"),
    INSTALLER("Installers"),
    OTHER("General")
}

enum class DownloadStatus {
    QUEUED,
    PROBING,
    DOWNLOADING,
    PAUSED,
    COMPLETED,
    ERROR,
    CANCELED
}

data class SegmentPlan(
    val index: Int,
    val startByte: Long,
    val endByte: Long?,
    var downloadedBytes: Long = 0L,
    var completed: Boolean = false
)

data class UrlInspection(
    val valid: Boolean,
    val supported: Boolean,
    val normalizedUrl: String,
    val filename: String,
    val category: FileCategory,
    val isExecutable: Boolean,
    val isHttps: Boolean,
    val reason: String? = null
)

object DownloadCore {
    private val unsupportedHosts = setOf(
        "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
        "netflix.com", "www.netflix.com",
        "spotify.com", "open.spotify.com",
        "primevideo.com", "www.primevideo.com",
        "disneyplus.com", "www.disneyplus.com",
        "hulu.com", "www.hulu.com",
        "twitch.tv", "www.twitch.tv"
    )

    private val executableExtensions = setOf(
        "exe", "msi", "apk", "bat", "cmd", "ps1", "sh", "dmg", "pkg", "appimage", "deb", "jar"
    )

    private val videoExts = setOf("mp4", "mkv", "webm", "mov", "avi", "m4v")
    private val audioExts = setOf("mp3", "wav", "flac", "aac", "ogg", "m4a", "opus")
    private val imageExts = setOf("jpg", "jpeg", "png", "webp", "gif", "svg", "bmp")
    private val docExts = setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "epub")
    private val archiveExts = setOf("zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso")

    fun inspectUrl(rawUrl: String): UrlInspection {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) {
            return UrlInspection(false, false, "", "", FileCategory.OTHER, false, false, "Enter a direct HTTP or HTTPS URL.")
        }

        val uri = try {
            URI(trimmed)
        } catch (_: Exception) {
            return UrlInspection(false, false, trimmed, "", FileCategory.OTHER, false, false, "Invalid URL format.")
        }

        val scheme = (uri.scheme ?: "").lowercase()
        if (scheme != "http" && scheme != "https") {
            return UrlInspection(false, false, trimmed, "", FileCategory.OTHER, false, false, "Only HTTP and HTTPS links are supported.")
        }

        val host = (uri.host ?: "").lowercase()
        val path = (uri.path ?: "").lowercase()
        if (unsupportedHosts.any { host == it || host.endsWith(".$it") } ||
            path.endsWith(".m3u8") || path.endsWith(".mpd")
        ) {
            return UrlInspection(
                valid = true,
                supported = false,
                normalizedUrl = trimmed,
                filename = "",
                category = FileCategory.VIDEO,
                isExecutable = false,
                isHttps = scheme == "https",
                reason = "This streaming or protected platform is not supported. Use the service's official download feature."
            )
        }

        val rawSegment = uri.path?.split('/')?.lastOrNull { it.isNotBlank() } ?: "download.bin"
        val cleanName = rawSegment.replace(Regex("[<>:\"/\\\\|?*\\x00-\\x1F]"), "_").ifBlank { "download.bin" }
        val ext = cleanName.substringAfterLast('.', "").lowercase()
        val category = when {
            ext in executableExtensions -> FileCategory.INSTALLER
            ext in videoExts -> FileCategory.VIDEO
            ext in audioExts -> FileCategory.AUDIO
            ext in imageExts -> FileCategory.IMAGE
            ext in docExts -> FileCategory.DOCUMENT
            ext in archiveExts -> FileCategory.ARCHIVE
            else -> FileCategory.OTHER
        }

        return UrlInspection(
            valid = true,
            supported = true,
            normalizedUrl = trimmed,
            filename = cleanName,
            category = category,
            isExecutable = ext in executableExtensions,
            isHttps = scheme == "https"
        )
    }

    fun computeSegments(
        totalBytes: Long?,
        requestedConnections: Int,
        acceptRanges: Boolean,
        minChunkSizeBytes: Long = 256L * 1024L
    ): List<SegmentPlan> {
        val safeConn = requestedConnections.coerceIn(1, 16)
        if (!acceptRanges || totalBytes == null || totalBytes <= 0L || safeConn == 1) {
            return listOf(
                SegmentPlan(
                    index = 0,
                    startByte = 0L,
                    endByte = if (totalBytes != null && totalBytes > 0L) totalBytes - 1L else null
                )
            )
        }

        val maxUseful = (totalBytes / minChunkSizeBytes).toInt().coerceAtLeast(1)
        val actualConn = minOf(safeConn, maxUseful)
        val chunkSize = totalBytes / actualConn
        return (0 until actualConn).map { idx ->
            val start = idx * chunkSize
            val end = if (idx == actualConn - 1) totalBytes - 1L else (idx + 1) * chunkSize - 1L
            SegmentPlan(index = idx, startByte = start, endByte = end)
        }
    }

    fun selectJobsToStart(
        jobs: List<Pair<String, DownloadStatus>>,
        maxConcurrent: Int
    ): List<String> {
        val limit = maxConcurrent.coerceAtLeast(1)
        val activeCount = jobs.count { it.second == DownloadStatus.DOWNLOADING || it.second == DownloadStatus.PROBING }
        val slots = (limit - activeCount).coerceAtLeast(0)
        if (slots == 0) return emptyList()
        return jobs.filter { it.second == DownloadStatus.QUEUED }.take(slots).map { it.first }
    }

    fun mapHttpError(code: Int): String = when (code) {
        401, 403 -> "Authentication or permission required (HTTP $code)."
        404 -> "File unavailable on server (HTTP 404)."
        410 -> "Download link has expired (HTTP 410). Request a fresh link."
        416 -> "Server rejected byte-range offset (HTTP 416). Restart download."
        429 -> "Server rate-limited parallel connections (HTTP 429). Falling back or retry shortly."
        in 500..599 -> "Server error (HTTP $code). Try resuming shortly."
        else -> "Download failed with HTTP status $code."
    }

    fun extractFirstHttpUrl(text: String): String? {
        val regex = Regex("https?://[^\\s<>\"'`]+", RegexOption.IGNORE_CASE)
        return regex.find(text)?.value?.trimEnd(')', ',', '.', ';', '!', '?')
    }
}
