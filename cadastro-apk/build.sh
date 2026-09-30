#!/usr/bin/env bash
# Gera build/cadastro-casa.apk (app nativo, sem Gradle nem bibliotecas: uns poucos KB).
# Uso: ./build.sh      (o endereço do hub muda dentro do app, no botão de engrenagem)
set -e
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
BT="$(ls -d "$SDK"/build-tools/* | grep -v rc | sort -V | tail -1)"
AJ="$SDK/platforms/android-34/android.jar"
JAVA_POSIX="${JAVA17_HOME:-/c/Program Files/Eclipse Adoptium/jdk-25.0.4.101-hotspot}"
export JAVA_HOME="$(cygpath -w "$JAVA_POSIX" 2>/dev/null || echo "$JAVA_POSIX")"   # os .bat do SDK pedem caminho Windows
export PATH="$JAVA_POSIX/bin:$PATH"
[ -f "$AJ" ] || { echo "falta a plataforma android-34 no SDK"; exit 1; }

rm -rf build && mkdir -p build/gen build/classes
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$AJ" --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 --version-code 1 --version-name 1.0 --java build/gen build/res.zip
javac --release 8 -nowarn -cp "$AJ" -d build/classes $(find src build/gen -name '*.java')
"$BT/d8.bat" --lib "$AJ" --min-api 24 --output build $(find build/classes -name '*.class')
(cd build && jar uf base.apk classes.dex)
"$BT/zipalign.exe" -f 4 build/base.apk build/aligned.apk

[ -f debug.keystore ] || keytool -genkeypair -keystore debug.keystore -storepass android -keypass android \
  -alias cadastrocasa -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Cadastro Casa" >/dev/null 2>&1
"$BT/apksigner.bat" sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android --out build/cadastro-casa.apk build/aligned.apk
"$BT/apksigner.bat" verify build/cadastro-casa.apk && ls -l build/cadastro-casa.apk
