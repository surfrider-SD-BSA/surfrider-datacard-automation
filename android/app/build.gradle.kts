import com.android.build.api.artifact.SingleArtifact

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val appId = providers.gradleProperty("tally.applicationId").get()
val beta = providers.gradleProperty("tally.beta").map { it.toBoolean() }.getOrElse(false)

android {
    namespace = "com.mateobesse.surfriderdatacards"
    compileSdk = 37

    defaultConfig {
        applicationId = appId
        // Android 9. `ImageDecoder` applies a capture's EXIF orientation on
        // the way in, and below it a page delivered sideways reaches
        // registration sideways -- which refuses it for a reason nobody can see.
        minSdk = 28
        targetSdk = 36
        // The store refuses a versionCode it has already seen. Pass
        // -Ptally.versionCode=... for anything uploaded; see README.md.
        versionCode = providers.gradleProperty("tally.versionCode").map { it.toInt() }.getOrElse(1)
        versionName = "0.1.0"

        buildConfigField("boolean", "CAMERA_CAPTURE", beta.toString())
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // The web bundle is already compressed where it can be, and the digit
    // model is read on every launch. Leaving it stored saves inflating 3.4MB
    // on the first screen.
    androidResources {
        noCompress += listOf("json", "png", "xlsx", "mjs", "js")
    }
}

// The reading pipeline is not in this project. It is `dist/`, built from
// src/ by the web tool and copied in by android/sync-web.sh, exactly as
// ios/sync-web.sh does for the iOS app. Without it the app opens to a reader
// that cannot read, so the build refuses rather than producing that.
val checkWebBundle = tasks.register("checkWebBundle") {
    // A local, not a script-level val: a task action that reaches back into the
    // build script cannot be stored in the configuration cache.
    val engine = layout.projectDirectory.file("src/main/assets/web/engine.html").asFile
    doLast {
        if (!engine.exists()) {
            throw GradleException(
                "The web bundle is missing from the app. Run android/sync-web.sh from the repository root, then build again.",
            )
        }
    }
}
tasks.named("preBuild") { dependsOn(checkWebBundle) }

// The app holds no network permission, and that is a promise to volunteers
// rather than a detail: see the top of AndroidManifest.xml. A dependency can
// break it without anyone touching this project -- ML Kit already tried -- so
// every build reads the MERGED manifest, the one that actually ships, and
// refuses to produce an app that could reach the network.
abstract class CheckNoNetwork : DefaultTask() {
    @get:InputFile
    abstract val manifest: RegularFileProperty

    @get:OutputFile
    abstract val stamp: RegularFileProperty

    @TaskAction
    fun check() {
        val text = manifest.get().asFile.readText()
        val found = Regex("""<uses-permission[^>]*android:name="(android\.permission\.(?:INTERNET|ACCESS_NETWORK_STATE|ACCESS_WIFI_STATE|CHANGE_NETWORK_STATE))"""")
            .findAll(text).map { it.groupValues[1] }.toList()
        if (found.isNotEmpty()) {
            throw GradleException(
                "The merged manifest asks for ${found.joinToString()}. This app must not have network access; " +
                    "remove it with tools:node=\"remove\" in AndroidManifest.xml, or decide in the open that the promise has changed.",
            )
        }
        stamp.get().asFile.writeText("no network permissions\n")
    }
}

androidComponents {
    onVariants { variant ->
        val name = variant.name.replaceFirstChar { it.uppercase() }
        val check = tasks.register<CheckNoNetwork>("check${name}NoNetwork") {
            manifest.set(variant.artifacts.get(SingleArtifact.MERGED_MANIFEST))
            stamp.set(layout.buildDirectory.file("intermediates/no-network/${variant.name}.txt"))
        }
        tasks.configureEach {
            if (this.name == "assemble$name" || this.name == "bundle$name" || this.name == "install$name") dependsOn(check)
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.webkit)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons.extended)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.mlkit.document.scanner)
}
