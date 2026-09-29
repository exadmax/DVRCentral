#!/usr/bin/env bash
# Gera build/central-diogo.apk (WebView para o painel de casa) sem Gradle.
# Uso: ./build.sh [URL-do-painel]     (padrão: http://192.168.0.10/)
set -e
cd "$(dirname "$0")"
URL="${1:-http://192.168.0.10/}"
HOST="$(echo "$URL" | sed -E 's#^https?://([^/:]+).*#\1#')"

SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
BT="$(ls -d "$SDK"/build-tools/* | grep -v rc | sort -V | tail -1)"
AJ="$SDK/platforms/android-34/android.jar"
JAVA_POSIX="${JAVA17_HOME:-/c/Program Files/Eclipse Adoptium/jdk-25.0.4.101-hotspot}"
export JAVA_HOME="$(cygpath -w "$JAVA_POSIX" 2>/dev/null || echo "$JAVA_POSIX")"   # os .bat do SDK pedem caminho Windows
export PATH="$JAVA_POSIX/bin:$PATH"
[ -f "$AJ" ] || { echo "falta a plataforma android-34 no SDK"; exit 1; }

rm -rf build && mkdir -p build/gen build/classes build/res
cp -r res/. build/res/
sed -i "s#__HUB_URL__#$URL#" build/res/values/strings.xml
sed -i "s#__HUB_HOST__#$HOST#" build/res/xml/network_security_config.xml

"$BT/aapt2" compile --dir build/res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$AJ" --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 --version-code 1 --version-name 1.0 --java build/gen build/res.zip
javac --release 8 -nowarn -cp "$AJ" -d build/classes $(find src build/gen -name '*.java')
"$BT/d8.bat" --lib "$AJ" --min-api 24 --output build $(find build/classes -name '*.class')
(cd build && jar uf base.apk classes.dex)
"$BT/zipalign.exe" -f 4 build/base.apk build/aligned.apk

[ -f debug.keystore ] || keytool -genkeypair -keystore debug.keystore -storepass android -keypass android \
  -alias centraldiogo -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Central Diogo" >/dev/null 2>&1
"$BT/apksigner.bat" sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android --out build/central-diogo.apk build/aligned.apk
"$BT/apksigner.bat" verify build/central-diogo.apk && ls -lh build/central-diogo.apk
echo "APK para: $URL"
