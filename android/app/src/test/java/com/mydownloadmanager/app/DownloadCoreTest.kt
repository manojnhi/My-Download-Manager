package com.mydownloadmanager.app

import org.junit.Assert.*
import org.junit.Test

class DownloadCoreTest {
    @Test
    fun `unsupported streaming sites are rejected with official download guidance`() {
        val result = DownloadCore.inspectUrl("https://www.youtube.com/watch?v=12345")
        assertTrue(result.valid)
        assertFalse(result.supported)
        assertTrue(result.reason?.contains("official download", ignoreCase = true) == true)
    }

    @Test
    fun `executables trigger warning flag and installer category`() {
        val result = DownloadCore.inspectUrl("https://example.org/releases/app-1.0.apk")
        assertTrue(result.supported)
        assertTrue(result.isExecutable)
        assertEquals(FileCategory.INSTALLER, result.category)
    }

    @Test
    fun `segments split across connections when ranges supported and fall back when unsupported`() {
        val ranged = DownloadCore.computeSegments(4L * 1024L * 1024L, 4, true)
        assertEquals(4, ranged.size)
        assertEquals(0L, ranged.first().startByte)
        assertEquals(4L * 1024L * 1024L - 1L, ranged.last().endByte)

        val fallback = DownloadCore.computeSegments(4L * 1024L * 1024L, 4, false)
        assertEquals(1, fallback.size)
    }

    @Test
    fun `queue scheduler respects max concurrent downloads`() {
        val next = DownloadCore.selectJobsToStart(
            listOf(
                "a" to DownloadStatus.DOWNLOADING,
                "b" to DownloadStatus.QUEUED,
                "c" to DownloadStatus.QUEUED
            ),
            maxConcurrent = 2
        )
        assertEquals(listOf("b"), next)
    }

    @Test
    fun `http status errors return clear messages`() {
        assertTrue(DownloadCore.mapHttpError(410).contains("expired", ignoreCase = true))
        assertTrue(DownloadCore.mapHttpError(401).contains("Authentication", ignoreCase = true))
    }
}
