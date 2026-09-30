# Cadastro Casa (APK)

App Android para cadastrar a **Geladeira/Dispensa** e os **Serviços** pelo celular, falando direto com a API do hub Go
(`/api/estoque` e `/api/contatos`, ver `docs/estoque-contatos.md`). Só intranet, sem login.

Feito para ser o menor possível: **Java puro**, sem AndroidX/Kotlin/WebView/Gradle, só as classes do próprio Android
(`HttpURLConnection` + `org.json`). O APK tem ~45 KB (quase tudo é o ícone). Código em um arquivo:
`src/br/com/diogo/cadastro/MainActivity.java`.

## Uso

- Duas abas (Geladeira / Serviços), busca, toque num item para editar ou excluir, **+ Novo** para cadastrar.
- Engrenagem: endereço do hub (padrão `http://192.168.0.10`). Só funciona no Wi-Fi de casa.
- Se `profissionaisSheet` estiver ligado no hub, os Serviços vêm da planilha e edições feitas no app são sobrescritas
  na próxima leitura.

## Gerar o APK

```bash
./build.sh        # -> build/cadastro-casa.apk
```

Precisa do Android SDK (build-tools + plataforma android-34) e de um JDK, como o `platforms/android`. O APK sai assinado
com uma chave de debug local (`debug.keystore`, ignorada pelo git); instale no celular por USB (`adb install`) ou
enviando o arquivo.
