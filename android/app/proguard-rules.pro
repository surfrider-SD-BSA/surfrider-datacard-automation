# The engine's replies are decoded by kotlinx.serialization, whose generated
# serializers R8 already keeps through the plugin's own rules.

# The fallback bridge, for WebViews too old for a WebMessageListener. R8 cannot
# see JavaScript call it, and a renamed method is a bridge that silently drops
# every answer.
-keepclassmembers class com.mateobesse.surfriderdatacards.tally.Engine$LegacyBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# ML Kit's document scanner finds its own internals by reflection, through the
# component registrars its manifest names. Minified, `GmsDocumentScanning
# .getClient` dies with a NullPointerException inside ML Kit -- measured on this
# app's first release build -- so its classes are kept whole. It is only reached
# in a build with -Ptally.beta=true.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_document_scanner.** { *; }
-keep class com.google.android.gms.internal.mlkit_common.** { *; }
-keep class com.google.firebase.components.** { *; }
