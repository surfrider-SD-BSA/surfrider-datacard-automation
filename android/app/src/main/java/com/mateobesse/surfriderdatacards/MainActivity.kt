//
//  Tally -- the data-card tool on the phone that is already at the cleanup.
//
//  THE READING IS NOT IMPLEMENTED IN KOTLIN AND SHOULD NEVER BE. Every figure in
//  HANDOFF.md -- registration, tally counting, digit recognition -- was
//  measured against the TypeScript in src/, on 1,606 pages. What is native here
//  is the interface. The pipeline runs in a WebView with no interface attached:
//  see tally/Engine.kt and src/engine.ts. A fix to the reading is a change to
//  src/ followed by android/sync-web.sh, never a change to anything here.
//
//  The eight screens are the iOS app's, screen for screen and word for word,
//  built in Compose with the platform's own conventions -- system back, edge to
//  edge, Material Symbols in place of SF Symbols. The design tokens are in
//  tally/Theme.kt, transcribed from the same handoff as Theme.swift.
//

package com.mateobesse.surfriderdatacards

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.content.IntentCompat
import com.mateobesse.surfriderdatacards.tally.TallyApp
import com.mateobesse.surfriderdatacards.tally.TallyModel

class MainActivity : ComponentActivity() {

    private val model: TallyModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        // Nocturne is dark throughout, so the bars are light-on-dark whatever
        // the phone's own theme.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)

        // Only on a fresh start. A recreated activity carries the intent it was
        // started with, and taking the same scan twice would start the cleanup
        // over a second time.
        if (savedInstanceState == null) receive(intent)

        setContent { TallyApp(model) }
    }

    /** A scan shared or opened while the app is already running. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receive(intent)
    }

    /**
     * The draft is debounced while typing. Going to the background is the one
     * moment that gap matters, so it is closed here.
     */
    override fun onStop() {
        super.onStop()
        model.flush()
    }

    /**
     * A PDF sent to the app: "Open with" from Files, Gmail or Drive, or a share
     * from anywhere. Not read on arrival -- the event comes first, and the scan
     * waits on screen 3. See `openExternal`.
     */
    private fun receive(intent: Intent?) {
        val uri: Uri = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
            else -> null
        } ?: return
        model.openExternal(uri)
    }
}
