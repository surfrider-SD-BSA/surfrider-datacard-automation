//
//  Files in and files out.
//
//  IN: a scan, from the picker, the share sheet, "Open with", or the document
//  scanner. Whatever hands it over, it is copied into the app's own cache
//  before anything reads it, and under the name the volunteer knows it by.
//  The copy is for the same reason PDFPicker.swift asks for one: a content://
//  grant is temporary and belongs to the moment it was given, and the read
//  happens later, inside the WebView, on another thread. The NAME matters as
//  much as the bytes -- the engine seeds the date and beach from it, and a
//  draft is only offered back to the file with the same name and size.
//
//  One scan at a time is kept. Taking a new one deletes the last, so the cache
//  never becomes a pile of old cleanups' handwriting.
//
//  OUT: the spreadsheet, and only the spreadsheet. Through the share sheet --
//  Drive, Gmail, Files, whatever the phone has -- or saved to a place the
//  volunteer picks. The scan is never offered to another app.
//

package com.mateobesse.surfriderdatacards.tally

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.util.UUID

/** A scan in the app's cache, with the name it arrived under. */
data class ScanFile(val file: File, val name: String)

object Incoming {

    private fun root(context: Context) = File(context.cacheDir, "incoming")

    /** A fresh directory for the next scan, with every earlier one removed. */
    fun freshDirectory(context: Context): File {
        val root = root(context)
        root.listFiles()?.forEach { it.deleteRecursively() }
        return File(root, UUID.randomUUID().toString()).apply { mkdirs() }
    }

    /**
     * Copy a PDF another app is showing us. Null if it cannot be read -- the
     * caller says so; the one thing this must not do is start a cleanup around
     * a file that is not there.
     *
     * Blocking; call it off the main thread.
     */
    fun copy(context: Context, uri: Uri): ScanFile? {
        val name = sanitize(displayName(context, uri) ?: uri.lastPathSegment ?: "scan.pdf")
        val target = File(freshDirectory(context), name)
        return try {
            val input = context.contentResolver.openInputStream(uri) ?: return null
            input.use { source -> target.outputStream().use { source.copyTo(it) } }
            if (target.length() == 0L) null else ScanFile(target, name)
        } catch (e: IOException) {
            null
        } catch (e: SecurityException) {
            null
        }
    }

    private fun displayName(context: Context, uri: Uri): String? = try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    } catch (e: Exception) {
        null
    }

    /** A name that is safe as a single path component, and still the volunteer's name for it. */
    fun sanitize(name: String): String {
        val clean = name.substringAfterLast('/').replace(Regex("[\\u0000-\\u001f]"), "").trim()
        return clean.ifEmpty { "scan.pdf" }
    }
}

object Spreadsheet {
    const val MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    private fun root(context: Context) = File(context.cacheDir, "exports")

    /**
     * Write a finished workbook where the share sheet can reach it.
     *
     * A fresh directory each time, as on iOS, and the earlier ones removed:
     * a spreadsheet of volunteer numbers has no business outliving the next.
     */
    fun write(context: Context, filename: String, bytes: ByteArray): File {
        val root = root(context)
        root.listFiles()?.forEach { it.deleteRecursively() }
        val dir = File(root, UUID.randomUUID().toString()).apply { mkdirs() }
        return File(dir, Incoming.sanitize(filename)).apply { writeBytes(bytes) }
    }

    /** The share sheet, over the file. How a file leaves an app on Android anyway. */
    fun share(context: Context, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = MIME
            putExtra(Intent.EXTRA_STREAM, uri)
            // ClipData as well as the extra: it is what carries the read grant
            // to the target, and what the sheet's preview is drawn from.
            clipData = ClipData.newRawUri(file.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, null))
    }

    /** Copy the finished file to a place the volunteer picked. True if it landed. */
    fun saveCopy(context: Context, file: File, destination: Uri): Boolean = try {
        context.contentResolver.openOutputStream(destination, "wt")?.use { out ->
            file.inputStream().use { it.copyTo(out) }
            true
        } ?: false
    } catch (e: IOException) {
        false
    } catch (e: SecurityException) {
        false
    }
}
