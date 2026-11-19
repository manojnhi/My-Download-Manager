package com.mydownloadmanager.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    private lateinit var engine: DownloadEngine
    private val sharedUrlState = mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        engine = DownloadEngine(applicationContext)
        extractIncomingLink(intent)

        setContent {
            val settings by engine.settings.collectAsState()
            val jobs by engine.jobs.collectAsState()
            val colorScheme = if (settings.darkMode) darkColorScheme() else lightColorScheme()

            MaterialTheme(colorScheme = colorScheme) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    DownloadManagerScreen(
                        initialUrl = sharedUrlState.value,
                        jobs = jobs,
                        settings = settings,
                        onAddUrl = { url -> engine.enqueue(url) },
                        onPause = { engine.pause(it) },
                        onResume = { engine.resume(it) },
                        onCancel = { engine.cancel(it) },
                        onRemove = { engine.remove(it) },
                        onUpdateSettings = { engine.updateSettings(it) }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        extractIncomingLink(intent)
    }

    private fun extractIncomingLink(intent: Intent?) {
        if (intent == null) return
        val incoming = when (intent.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_VIEW -> intent.dataString
            else -> null
        } ?: return
        DownloadCore.extractFirstHttpUrl(incoming)?.let {
            sharedUrlState.value = it
        }
    }
}

@Composable
fun DownloadManagerScreen(
    initialUrl: String,
    jobs: List<DownloadJobState>,
    settings: ManagerSettings,
    onAddUrl: (String) -> Unit,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onCancel: (String) -> Unit,
    onRemove: (String) -> Unit,
    onUpdateSettings: (ManagerSettings) -> Unit
) {
    var urlInput by remember(initialUrl) { mutableStateOf(initialUrl) }
    var pendingExecutableUrl by remember { mutableStateOf<String?>(null) }
    var urlError by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "My Download Manager",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            TextButton(onClick = { onUpdateSettings(settings.copy(darkMode = !settings.darkMode)) }) {
                Text(if (settings.darkMode) "Light Mode" else "Dark Mode")
            }
        }

        OutlinedTextField(
            value = urlInput,
            onValueChange = { urlInput = it; urlError = null },
            label = { Text("Direct file URL (HTTP / HTTPS)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        urlError?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Button(
            onClick = {
                val check = DownloadCore.inspectUrl(urlInput)
                if (!check.valid || !check.supported) {
                    urlError = check.reason
                } else if (check.isExecutable) {
                    pendingExecutableUrl = check.normalizedUrl
                } else {
                    onAddUrl(check.normalizedUrl)
                    urlInput = ""
                }
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Start Download")
        }

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            items(jobs, key = { it.id }) { job ->
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(job.filename, fontWeight = FontWeight.SemiBold)
                        Text(
                            "${job.status.name} · ${job.connectionsUsed} conn · ${job.downloadedBytes} / ${job.totalBytes ?: "?"} bytes",
                            style = MaterialTheme.typography.bodySmall
                        )
                        job.error?.let {
                            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (job.status == DownloadStatus.DOWNLOADING) {
                                OutlinedButton(onClick = { onPause(job.id) }) { Text("Pause") }
                            } else if (job.status == DownloadStatus.PAUSED || job.status == DownloadStatus.ERROR) {
                                OutlinedButton(onClick = { onResume(job.id) }) { Text("Resume") }
                            }
                            if (job.status != DownloadStatus.COMPLETED && job.status != DownloadStatus.CANCELED) {
                                TextButton(onClick = { onCancel(job.id) }) { Text("Cancel") }
                            }
                            TextButton(onClick = { onRemove(job.id) }) { Text("Remove") }
                        }
                    }
                }
            }
        }
    }

    pendingExecutableUrl?.let { exeUrl ->
        AlertDialog(
            onDismissRequest = { pendingExecutableUrl = null },
            title = { Text("Executable File Warning") },
            text = {
                Text("This link points to an executable/installer file. Verify you trust the source URL before downloading. It will never be executed automatically.\n\nSource: $exeUrl")
            },
            confirmButton = {
                Button(onClick = {
                    onAddUrl(exeUrl)
                    pendingExecutableUrl = null
                    urlInput = ""
                }) { Text("Download File") }
            },
            dismissButton = {
                TextButton(onClick = { pendingExecutableUrl = null }) { Text("Cancel") }
            }
        )
    }
}
