# R8 у release: міст JS і служби викликаються за іменем (WebView, маніфест, FCM)
-keep class com.dialer.callstyle.** { *; }
-keepclassmembers class com.dialer.callstyle.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
