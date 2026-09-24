//
//  2 — Event details
//
//  The header fields that appear only on the leader's card. Maps to
//  `eventMetadata` in src/lib/schema.ts and HEADER_ROWS in taxonomy.ts.
//
//  Duration defaults to two hours and the club to the chapter string. Both are
//  off-screen defaults rather than questions, because they are the same at
//  every cleanup this chapter runs.
//
//  THE KEYBOARD. iOS lets the keyboard cover the pinned button and scrolls the
//  form itself. Android draws edge to edge, so the screen has to make room for
//  the keyboard explicitly -- `imePadding` below -- or the field being typed in
//  can end up underneath it.
//

package com.mateobesse.surfriderdatacards.tally.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mateobesse.surfriderdatacards.tally.ButtonIcon
import com.mateobesse.surfriderdatacards.tally.Field
import com.mateobesse.surfriderdatacards.tally.FieldInput
import com.mateobesse.surfriderdatacards.tally.NavBar
import com.mateobesse.surfriderdatacards.tally.Nocturne
import com.mateobesse.surfriderdatacards.tally.PrimaryButton
import com.mateobesse.surfriderdatacards.tally.Screen
import com.mateobesse.surfriderdatacards.tally.ScreenBody
import com.mateobesse.surfriderdatacards.tally.BottomClearance
import com.mateobesse.surfriderdatacards.tally.TallyModel
import com.mateobesse.surfriderdatacards.tally.WithPinnedActions
import com.mateobesse.surfriderdatacards.tally.pageMargin
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle

@Composable
fun EventScreen(model: TallyModel) {
    var picking by remember { mutableStateOf(false) }

    ScreenBody {
        Column(Modifier.weight(1f).imePadding()) {
            NavBar(back = "Cleanups", onBack = model::back)

            WithPinnedActions(
                actions = {
                    PrimaryButton(
                        onClick = { model.push(Screen.Capture) },
                        enabled = model.event.isComplete,
                    ) {
                        ButtonIcon(Nocturne.Icon.capture)
                        Text("Scan the cards")
                    }

                    // Name what is actually missing. "A date and a beach" is no
                    // help when one of the two is already filled in and the
                    // disabled button will not say which.
                    Text(
                        gateCaption(model),
                        style = Nocturne.Face.label(12),
                        color = Nocturne.text(45),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                },
            ) { clearance ->
                Column(
                    modifier = Modifier
                        .verticalScroll(rememberScrollState())
                        .padding(top = 6.dp)
                        .pageMargin(),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("The event", style = Nocturne.Face.title(28), color = Nocturne.text)
                        Text(
                            "Only the date and the beach are needed to finish. The rest is written on the leader's card and often on no other, so it is never held against you.",
                            style = Nocturne.Face.body(13),
                            color = Nocturne.text(60),
                        )
                    }

                    Field(label = "Date") {
                        // The field shows exactly what the model holds, and
                        // nothing else. See the trap in ios/HANDOFF.md: a
                        // control that displays a value the model does not have
                        // left "Scan the cards" disabled for no visible reason.
                        Text(
                            displayDate(model.event.date),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    role = Role.Button,
                                    onClickLabel = "Change the date",
                                ) { picking = true }
                                .padding(vertical = 12.dp),
                        )
                    }

                    Field(label = "Beach") {
                        FieldInput(
                            value = model.event.shoreline,
                            onValueChange = { model.event = model.event.copy(shoreline = it) },
                            placeholder = "Pacific Beach",
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                        )
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Field(label = "Volunteers", optional = true, modifier = Modifier.weight(1f)) {
                            FieldInput(
                                value = model.event.volunteers,
                                onValueChange = { model.event = model.event.copy(volunteers = it) },
                                placeholder = "—",
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            )
                        }
                        Field(label = "Pounds", optional = true, modifier = Modifier.weight(1f)) {
                            FieldInput(
                                value = model.event.pounds,
                                onValueChange = { model.event = model.event.copy(pounds = it) },
                                placeholder = "—",
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            )
                        }
                    }

                    Field(label = "Your name", optional = true) {
                        FieldInput(
                            value = model.event.dataEntryVolunteer,
                            onValueChange = { model.event = model.event.copy(dataEntryVolunteer = it) },
                            placeholder = "Who is doing the entry",
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                        )
                    }

                    BottomClearance(clearance)
                }
            }
        }
    }

    if (picking) {
        DateDialog(
            iso = model.event.date,
            onPick = { model.event = model.event.copy(date = it) },
            onDismiss = { picking = false },
        )
    }
}

private fun gateCaption(model: TallyModel): String {
    val noDate = model.event.date.isEmpty()
    val noBeach = model.event.shoreline.isBlank()
    return when {
        !noDate && !noBeach -> "Everything needed is here."
        noDate && noBeach -> "A date and a beach, and you can start."
        noDate -> "Just a date, and you can start."
        else -> "Just a beach, and you can start."
    }
}

/** "22 Sept 2026", in the phone's own format. The model holds ISO, and this only reads it. */
private fun displayDate(iso: String): String = try {
    LocalDate.parse(iso).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
} catch (e: DateTimeParseException) {
    iso
}

/**
 * The form holds strings, because that is what the exporter takes and what the
 * draft stores. The picker wants milliseconds, so it gets them here and nowhere
 * else -- and at UTC midnight, which is what Material's picker counts in. Local
 * midnight would move the date back a day for everybody west of Greenwich.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateDialog(iso: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val initial = try {
        LocalDate.parse(iso).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    } catch (e: DateTimeParseException) {
        null
    }
    val state = rememberDatePickerState(initialSelectedDateMillis = initial)

    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let {
                    onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString())
                }
                onDismiss()
            }) { Text("Done", color = Nocturne.accent) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = Nocturne.accent) }
        },
    ) {
        DatePicker(state = state)
    }
}
