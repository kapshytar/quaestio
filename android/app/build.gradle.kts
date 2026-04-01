import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
}

fun runGitCommand(projectDir: File, vararg args: String): String? {
    return try {
        val process = ProcessBuilder(listOf("git", *args))
            .directory(projectDir)
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.bufferedReader().use { it.readText().trim() }
        if (process.waitFor() == 0 && output.isNotBlank()) output else null
    } catch (_: Exception) {
        null
    }
}

val ciVersionCode = System.getenv("VERSION_CODE")?.toIntOrNull()
val versionProperties = Properties().apply {
    val versionFile = rootProject.file("version.properties")
    if (versionFile.exists()) {
        versionFile.inputStream().use { load(it) }
    }
}
val fileVersionCode = versionProperties.getProperty("VERSION_CODE")?.toIntOrNull()
val versionBase = versionProperties.getProperty("VERSION_BASE")?.trim().takeUnless { it.isNullOrBlank() } ?: "1.0"
val versionPatch = versionProperties.getProperty("VERSION_PATCH")?.toIntOrNull() ?: 0
val resolvedVersionCode = ciVersionCode ?: fileVersionCode ?: 1
val gitShortSha = runGitCommand(rootProject.projectDir, "rev-parse", "--short", "HEAD") ?: "nogit"
val gitCommitCount = runGitCommand(rootProject.projectDir, "rev-list", "--count", "HEAD") ?: resolvedVersionCode.toString()
val semverVersionName = "$versionBase.$versionPatch"
val runtimeVersionName = "$semverVersionName+$gitCommitCount.$gitShortSha"
val signingKeystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
val signingStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val signingKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
val signingKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")
// Dream Tracker credentials are hardcoded by request.
val dreamTrackerRpcUrl = "https://bjqkvlsneujrcfpvcvzf.supabase.co"
val dreamTrackerApiKey = "***REMOVED-OLD-JWT***"
val dreamTrackerAppId = "chat-aggregator"
val hasCustomSigning =
    !signingKeystorePath.isNullOrBlank() &&
    !signingStorePassword.isNullOrBlank() &&
    !signingKeyAlias.isNullOrBlank() &&
    !signingKeyPassword.isNullOrBlank()
val changelogSourceFile = rootProject.file("CHANGELOG.md")
val generatedChangelogResDir = layout.buildDirectory.dir("generated/res/changelog")
val generatedSharedAssetsDir = layout.buildDirectory.dir("generated/assets/shared")
val generateLatestChangelogResource = tasks.register("generateLatestChangelogResource") {
    val outputDir = generatedChangelogResDir.get().asFile.resolve("raw")
    val outputFile = outputDir.resolve("changelog_latest.txt")
    inputs.file(changelogSourceFile)
    outputs.file(outputFile)
    doLast {
        outputDir.mkdirs()
        val markdown = if (changelogSourceFile.exists()) changelogSourceFile.readText() else ""
        val entries = mutableListOf<String>()
        var currentVersion = ""
        var currentSection = ""
        markdown.lineSequence().forEach { rawLine ->
            val line = rawLine.trim()
            val versionMatch = Regex("""^##\s+\[([^\]]+)]""").find(line)
            if (versionMatch != null) {
                currentVersion = versionMatch.groupValues[1].trim()
                return@forEach
            }
            val sectionMatch = Regex("""^###\s+(.+)$""").find(line)
            if (sectionMatch != null) {
                currentSection = sectionMatch.groupValues[1].trim()
                return@forEach
            }
            if ((line.startsWith("- ") || line.startsWith("* ")) && entries.size < 30) {
                val text = line.substring(2).trim()
                val prefix = buildString {
                    if (currentVersion.isNotBlank()) append("[").append(currentVersion).append("] ")
                    if (currentSection.isNotBlank()) append(currentSection).append(": ")
                }
                entries += "${prefix}${text}"
            }
        }
        outputFile.writeText(
            if (entries.isEmpty()) "No changelog entries found."
            else entries.joinToString(System.lineSeparator())
        )
    }
}
val prepareSharedStreamingJs = tasks.register<Copy>("prepareSharedStreamingJs") {
    from(rootProject.file("../shared/js/mergeStreamParser.js"))
    from(rootProject.file("../shared/js/scrapeReply.js"))
    into(generatedSharedAssetsDir)
}

android {
    namespace = "com.chataggregator.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.chataggregator.app"
        minSdk = 26
        targetSdk = 36
        versionCode = resolvedVersionCode
        versionName = semverVersionName
    }

    signingConfigs {
        create("release") {
            if (hasCustomSigning) {
                storeFile = file(signingKeystorePath!!)
                storePassword = signingStorePassword
                keyAlias = signingKeyAlias
                keyPassword = signingKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("String", "DREAM_TRACKER_RPC_URL", "\"$dreamTrackerRpcUrl\"")
            buildConfigField("String", "DREAM_TRACKER_API_KEY", "\"$dreamTrackerApiKey\"")
            buildConfigField("String", "DREAM_TRACKER_APP_ID", "\"$dreamTrackerAppId\"")
            buildConfigField("String", "GIT_SHORT_SHA", "\"$gitShortSha\"")
            buildConfigField("String", "GIT_COMMIT_COUNT", "\"$gitCommitCount\"")
            buildConfigField("String", "DISPLAY_VERSION", "\"${runtimeVersionName}-debug\"")
            buildConfigField("String", "BASE_SEMVER", "\"$semverVersionName\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            buildConfigField("String", "DREAM_TRACKER_RPC_URL", "\"$dreamTrackerRpcUrl\"")
            buildConfigField("String", "DREAM_TRACKER_API_KEY", "\"$dreamTrackerApiKey\"")
            buildConfigField("String", "DREAM_TRACKER_APP_ID", "\"$dreamTrackerAppId\"")
            buildConfigField("String", "GIT_SHORT_SHA", "\"$gitShortSha\"")
            buildConfigField("String", "GIT_COMMIT_COUNT", "\"$gitCommitCount\"")
            buildConfigField("String", "DISPLAY_VERSION", "\"$runtimeVersionName\"")
            buildConfigField("String", "BASE_SEMVER", "\"$semverVersionName\"")
            if (hasCustomSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    sourceSets["main"].res.srcDir(generatedChangelogResDir.get().asFile)
    sourceSets["main"].assets.srcDir(rootProject.file("../shared/contracts"))
    sourceSets["main"].assets.srcDir(generatedSharedAssetsDir.get().asFile)
}

tasks.matching {
    it.name.contains("Resources", ignoreCase = true) ||
        it.name.contains("Assets", ignoreCase = true) ||
        it.name.contains("Navigation", ignoreCase = true) ||
        it.name.contains("SourceSetPaths", ignoreCase = true)
}
    .configureEach {
        dependsOn(generateLatestChangelogResource)
        dependsOn(prepareSharedStreamingJs)
    }

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.13.0")
    implementation("androidx.constraintlayout:constraintlayout:2.2.1")
    implementation("androidx.viewpager2:viewpager2:1.1.0")
    implementation("androidx.webkit:webkit:1.15.0")
    implementation("com.google.code.gson:gson:2.13.2")
    implementation("androidx.preference:preference-ktx:1.2.1")
    implementation("com.android.billingclient:billing-ktx:8.3.0")
    implementation("io.noties.markwon:core:4.6.2")
    implementation("io.noties.markwon:ext-tables:4.6.2")
    implementation("org.mozilla:rhino:1.7.15")
}
