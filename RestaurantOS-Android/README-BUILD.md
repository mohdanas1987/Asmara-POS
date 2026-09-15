# Building the RestaurantOS Android terminal (sideload only, no Play Store)

This is a **thin client**, not a second copy of the POS. It does not run a backend, database,
or Next.js server on the Android device -- it is a small WebView app that connects over your
restaurant's own WiFi to the main POS computer (the Windows/Mac machine running
`RestaurantOS-Desktop`), the same way the customer-facing display window on that machine
works today. All order/menu/table data stays on that one machine; the tablet is just a screen
for it, exactly like a second monitor would be.

It is **never submitted to the Google Play Store**. You install the `.apk` file directly onto
each Android POS tablet/terminal (this is normal for restaurant hardware -- most Android POS
terminals are set up this way), and updating it later just means copying a new `.apk` over.

## Why this couldn't be built inside the sandboxed session

Building an actual `.apk` needs the Android SDK and Google's/Maven's build-tool packages
(`com.android.tools.build:gradle`, etc.), fetched from `dl.google.com` and Maven Central. The
cloud sandbox used to build and verify the rest of this project only has network access to an
allow-listed set of hosts (npm, PyPI, GitHub, and a few others) and `dl.google.com` /
`repo.maven.apache.org` are not on that list -- every attempt to fetch them was refused
(403) by the sandbox's own network policy, not by Google or Maven. This is a real,
verified limitation of the build sandbox, not a guess -- see VERIFICATION.md's Android
entry for the exact commands and errors.

Everything that COULD be verified without those hosts was: this Capacitor Android project was
generated for real (`npx cap add android`, a genuine Gradle project, not hand-typed), and the
WebView shell (`www/index.html`) is real, plain HTML/JS with no build step of its own, so it's
already exactly what will run once packaged.

## What you need (all free, no Apple/Google developer account required)

1. **Android Studio** (free, from https://developer.android.com/studio) on any Windows, Mac,
   or Linux machine you have. Installing it also installs the Android SDK automatically.
2. Open this `RestaurantOS-Android` folder in Android Studio (`File > Open`, pick this folder).
   Let it finish syncing Gradle the first time (it downloads the SDK components it needs).

## Building the APK

Either from Android Studio's menu (`Build > Build Bundle(s)/APK(s) > Build APK(s)`), or from a
terminal in this folder:

```
cd android
./gradlew assembleRelease
```

The `.apk` lands at `android/app/build/outputs/apk/release/app-release.apk`. For a quick test
without setting up signing, `assembleDebug` produces an installable debug APK instead (that's
fine for internal use on your own restaurant's tablets -- signing only matters for the Play
Store, which this app is never submitted to).

## Installing on a tablet (sideloading)

1. On the Android tablet: Settings > Security > enable "Install from unknown sources" (or
   "Install unknown apps" for the file manager / browser you'll use) -- this is standard for
   any app installed outside the Play Store, not specific to this one.
2. Copy the `.apk` onto the tablet (USB cable, or share it over your restaurant's WiFi) and
   open it to install, exactly like installing an app from a website.

## First run on the tablet

The app asks once for the main POS computer's address on your WiFi network (e.g.
`192.168.1.42` -- the Windows/Mac machine's local IP, shown on that machine's own setup
screen). It remembers it after that. Tap the top-left corner 3 times to bring that screen back
up if you ever need to change it (e.g. the POS computer's IP changed, or you're setting up a
new tablet).

## A note on plain HTTP

This app deliberately allows plain (non-HTTPS) connections (`usesCleartextTraffic="true"` in
`android/app/src/main/AndroidManifest.xml`) because it talks to the POS computer over your
restaurant's own closed WiFi network, which -- like every other machine in this project --
never has HTTPS wired up (nothing here talks to the public internet). This is the same
tradeoff the desktop app itself already makes for its own local backend.
