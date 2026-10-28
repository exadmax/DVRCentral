package main

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------- leitor de FAT12 (só para conferir o que o hub gravou) ----------

func readFloppy(t *testing.T, img []byte) map[string][]byte {
	t.Helper()
	if len(img) != fdSectors*fdSectorSize || img[510] != 0x55 || img[511] != 0xAA {
		t.Fatalf("imagem de disquete inválida (%d bytes)", len(img))
	}
	fat := img[fdSectorSize : fdSectorSize+fdFATSectors*fdSectorSize]
	next := func(c int) int {
		o := c * 3 / 2
		v := int(fat[o]) | int(fat[o+1])<<8
		if c%2 == 0 {
			return v & 0xFFF
		}
		return v >> 4
	}
	chain := func(c, size int) []byte {
		var out []byte
		for n := 0; c >= 2 && c < 0xFF8 && n < 4000; n++ {
			off := (fdFirstData + c - 2) * fdSectorSize
			out = append(out, img[off:off+fdSectorSize]...)
			c = next(c)
		}
		if size >= 0 && size <= len(out) {
			out = out[:size]
		}
		return out
	}
	out := map[string][]byte{}
	var walk func(dir []byte, prefix string)
	walk = func(dir []byte, prefix string) {
		for i := 0; i+32 <= len(dir); i += 32 {
			e := dir[i : i+32]
			if e[0] == 0 {
				break
			}
			if e[0] == 0xE5 || e[0] == '.' {
				continue
			}
			name := strings.TrimRight(string(e[:8]), " ")
			if ext := strings.TrimRight(string(e[8:11]), " "); ext != "" {
				name += "." + ext
			}
			cl := int(binary.LittleEndian.Uint16(e[26:]))
			size := int(binary.LittleEndian.Uint32(e[28:]))
			if e[11]&0x10 != 0 {
				walk(chain(cl, -1), prefix+name+"/")
			} else {
				out[prefix+name] = chain(cl, size)
			}
		}
	}
	rootOff := (1 + 2*fdFATSectors) * fdSectorSize
	walk(img[rootOff:rootOff+fdRootEntry*32], "")
	return out
}

func TestFatName(t *testing.T) {
	used := map[string]bool{}
	cases := []struct{ in, want string }{
		{"SETUP.EXE", "SETUP   EXE"},
		{"readme.txt", "README  TXT"},
		{"muito comprido.html", "MUITOC~1HTM"},
		{"ARROW.WA_", "ARROW   WA_"},
		{"Árvore.txt", "_RVORE  TXT"},
	}
	for _, c := range cases {
		got := fatName(c.in, used)
		used[got] = true
		if got != c.want {
			t.Errorf("fatName(%q) = %q, esperava %q", c.in, got, c.want)
		}
	}
	// nomes que colidem ao encurtar ganham ~N
	a := fatName("documento-um.txt", used)
	used[a] = true
	b := fatName("documento-dois.txt", used)
	if a == b || !strings.Contains(b, "~") {
		t.Errorf("colisão não resolvida: %q e %q", a, b)
	}
}

func TestFloppyRoundTrip(t *testing.T) {
	big := bytes.Repeat([]byte("0123456789abcdef"), 4000) // 64 KB, várias entradas na FAT
	files := []vmFile{
		{Name: "SETUP.EXE", Data: []byte("MZ-fake-setup"), Mod: time.Date(1996, 4, 16, 6, 3, 0, 0, time.UTC)},
		{Name: "DESKTOP.DA_", Data: big},
		{Name: "dados/LEIAME.TXT", Data: []byte("oi")},
		{Name: "dados/sub/vazio.bin", Data: nil},
		{Name: "dados/sub/outro arquivo longo.dat", Data: []byte("abc")},
	}
	img, err := buildFloppy(files, "teste")
	if err != nil {
		t.Fatal(err)
	}
	got := readFloppy(t, img)
	want := map[string][]byte{
		"SETUP.EXE":              files[0].Data,
		"DESKTOP.DA_":            big,
		"DADOS/LEIAME.TXT":       []byte("oi"),
		"DADOS/SUB/VAZIO.BIN":    {},
		"DADOS/SUB/OUTROA~1.DAT": []byte("abc"),
	}
	for k, v := range want {
		if g, ok := got[k]; !ok || !bytes.Equal(g, v) {
			t.Errorf("%s: esperava %d bytes, veio %v (%d)", k, len(v), ok, len(g))
		}
	}
	if len(got) != len(files) {
		t.Errorf("esperava %d arquivos, vieram %d: %v", len(files), len(got), keys(got))
	}
}

func keys(m map[string][]byte) []string {
	var k []string
	for n := range m {
		k = append(k, n)
	}
	return k
}

func TestFloppyLimites(t *testing.T) {
	// cabe exatamente
	if _, err := buildFloppy([]vmFile{{Name: "A.BIN", Data: make([]byte, fdMaxBytes)}}, "x"); err != nil {
		t.Errorf("um arquivo do tamanho total do disquete deveria caber: %v", err)
	}
	if _, err := buildFloppy([]vmFile{{Name: "A.BIN", Data: make([]byte, fdMaxBytes+1)}}, "x"); err == nil {
		t.Error("um byte a mais deveria recusar")
	}
	// raiz cheia: 225 arquivos pequenos
	var many []vmFile
	for i := 0; i < fdRootEntry+1; i++ {
		many = append(many, vmFile{Name: fmt.Sprintf("F%d.TXT", i), Data: []byte("x")})
	}
	if _, err := buildFloppy(many, "x"); err == nil {
		t.Error("mais de 224 entradas na raiz deveria recusar")
	}
}

// ---------- dosbox.conf ----------

const confWin95 = "\n[sdl]\nautolock=true\nmouse emulation=integration\n\n[cpu]\ncputype=pentium\n\n[autoexec]\necho off\n\nimgmount 2 system-win95-v1.qcow2\n\necho Please visit our website:\necho type 'boot c:' to load windows 95\necho on\n# QR code\n"

func TestVmConf(t *testing.T) {
	got, disks, err := vmConf(confWin95, false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, ".qcow2") || strings.Contains(got, "Please visit") {
		t.Errorf("conf ainda cita .qcow2 ou o texto do prompt:\n%s", got)
	}
	for _, s := range []string{"autolock=true", "[cpu]", "imgmount 2 system-win95-v1.disk", "boot c:"} {
		if !strings.Contains(got, s) {
			t.Errorf("faltou %q na conf:\n%s", s, got)
		}
	}
	if len(disks) != 1 || disks[0] != "system-win95-v1.disk" {
		t.Errorf("discos: %v", disks)
	}
	if strings.Contains(got, "imgmount 0") {
		t.Error("sem disquete não deveria ter imgmount 0")
	}
	// de novo, agora com disquete: troca sem duplicar
	again, _, err := vmConf(got, true)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(again, "imgmount 2") != 1 || strings.Count(again, "imgmount 0 install.img -t floppy") != 1 || strings.Count(again, "boot c:") != 1 {
		t.Errorf("conf com disquete:\n%s", again)
	}
	third, _, _ := vmConf(again, true)
	if third != again {
		t.Error("vmConf deveria ser idempotente")
	}
	back, _, _ := vmConf(again, false)
	if back != got {
		t.Errorf("tirar o disquete deveria voltar ao original:\n%s\n---\n%s", back, got)
	}
	// CRLF
	if _, _, err := vmConf(strings.ReplaceAll(confWin95, "\n", "\r\n"), false); err != nil {
		t.Errorf("conf com CRLF: %v", err)
	}
	// sem disco montado
	if _, _, err := vmConf("[sdl]\nautolock=true\n[autoexec]\necho oi\n", false); err == nil {
		t.Error("conf sem imgmount deveria dar erro")
	}
	if _, _, err := vmConf("[sdl]\nautolock=true\n", false); err == nil {
		t.Error("conf sem [autoexec] deveria dar erro")
	}
}

// ---------- fluxo pela API ----------

func zipBytes(t *testing.T, files map[string][]byte, method uint16) []byte {
	t.Helper()
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	for n, d := range files {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: n, Method: method, Modified: time.Date(2025, 4, 1, 12, 0, 0, 0, time.UTC)})
		if err != nil {
			t.Fatal(err)
		}
		w.Write(d)
	}
	zw.Close()
	return b.Bytes()
}

func readZip(t *testing.T, b []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("zip inválido: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		d, err := io.ReadAll(rc) // confere o CRC
		rc.Close()
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		out[f.Name] = d
	}
	return out
}

func TestVmFluxo(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("ana", "senha-da-ana", false, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	ca, cb := e.login("ana", "senha-da-ana"), e.login("beto", "senha-do-beto")
	put := func(c, p string, data []byte) {
		t.Helper()
		if w := e.req("PUT", "/api/desk/fs/file?space=home&path="+p+"&overwrite=1", data, c); w.Code != 200 {
			t.Fatalf("PUT %s: %d %s", p, w.Code, w.Body.String())
		}
	}
	mk := func(c, p string) {
		e.req("POST", "/api/desk/fs/mkdir", map[string]string{"space": "home", "path": p}, c)
	}
	get := func(c, p string) []byte {
		t.Helper()
		w := e.req("GET", "/api/desk/fs/read?space=home&mode=download&path="+p, nil, c)
		if w.Code != 200 {
			t.Fatalf("GET %s: %d", p, w.Code)
		}
		return w.Body.Bytes()
	}
	disk := bytes.Repeat([]byte("QFI\xfb-disco-do-windows-"), 20000) // ~400 KB, compressível
	pkg := zipBytes(t, map[string][]byte{
		".jsdos/dosbox.conf":    []byte(confWin95),
		".jsdos/jsdos.json":     []byte(`{"version":"8.3.3"}`),
		"system-win95-v1.qcow2": disk,
	}, zip.Deflate)
	mk(ca, "/Programas")
	mk(ca, "/Programas/Instaladores")
	put(ca, "/Programas/Instaladores/win95.jsdos", pkg)

	vm := func(c, op string, body any) (int, map[string]any) {
		w := e.req("POST", "/api/desk/vm/"+op, body, c)
		var m map[string]any
		json.Unmarshal(w.Body.Bytes(), &m)
		return w.Code, m
	}

	// validações
	if c, _ := vm(ca, "prepare", map[string]string{"src": "/Programas/Instaladores/win95.jsdos", "id": "Win 95!"}); c != 400 {
		t.Errorf("id inválido deveria dar 400, deu %d", c)
	}
	if c, _ := vm(ca, "prepare", map[string]string{"src": "/nao-existe.jsdos", "id": "win95"}); c != 404 {
		t.Errorf("origem inexistente deveria dar 404, deu %d", c)
	}
	put(ca, "/Programas/Instaladores/lixo.jsdos", []byte("isto não é um zip"))
	if c, m := vm(ca, "prepare", map[string]string{"src": "/Programas/Instaladores/lixo.jsdos", "id": "lixo"}); c != 400 {
		t.Errorf("zip inválido deveria dar 400, deu %d %v", c, m)
	}
	semConf := zipBytes(t, map[string][]byte{"a.txt": []byte("a")}, zip.Store)
	put(ca, "/Programas/Instaladores/semconf.jsdos", semConf)
	if c, _ := vm(ca, "prepare", map[string]string{"src": "/Programas/Instaladores/semconf.jsdos", "id": "semconf"}); c != 400 {
		t.Errorf("pacote sem dosbox.conf deveria dar 400, deu %d", c)
	}
	semDisco := zipBytes(t, map[string][]byte{".jsdos/dosbox.conf": []byte(confWin95)}, zip.Store)
	put(ca, "/Programas/Instaladores/semdisco.jsdos", semDisco)
	if c, _ := vm(ca, "prepare", map[string]string{"src": "/Programas/Instaladores/semdisco.jsdos", "id": "semdisco"}); c != 400 {
		t.Errorf("conf que monta um disco que não existe deveria dar 400, deu %d", c)
	}

	// preparar
	c, m := vm(ca, "prepare", map[string]string{"src": "/Programas/Instaladores/win95.jsdos", "id": "win95"})
	if c != 200 {
		t.Fatalf("prepare: %d %v", c, m)
	}
	bundle := "/Programas/Sistemas/win95/win95.jsdos"
	z := readZip(t, get(ca, bundle))
	if _, ok := z["system-win95-v1.qcow2"]; ok {
		t.Error("o disco deveria ter sido renomeado")
	}
	if !bytes.Equal(z["system-win95-v1.disk"], disk) {
		t.Error("o conteúdo do disco mudou")
	}
	conf := string(z[".jsdos/dosbox.conf"])
	if strings.Contains(conf, ".qcow2") || !strings.Contains(conf, "boot c:") || !strings.Contains(conf, "imgmount 2 system-win95-v1.disk") {
		t.Errorf("dosbox.conf preparado:\n%s", conf)
	}
	if c, _ := vm(ca, "prepare", map[string]string{"src": "/Programas/Instaladores/win95.jsdos", "id": "win95"}); c != 409 {
		t.Errorf("preparar de novo deveria dar 409, deu %d", c)
	}

	// disquete
	jogo := zipBytes(t, map[string][]byte{
		"ida/SETUP.EXE":   []byte("MZ-setup"),
		"ida/SETUP.INI":   []byte("[setup]\n"),
		"ida/DESKTOP.DA_": bytes.Repeat([]byte{7}, 90000),
	}, zip.Deflate)
	put(ca, "/Programas/Instaladores/jogo.zip", jogo)
	c, m = vm(ca, "attach", map[string]string{"id": "win95", "zip": "/Programas/Instaladores/jogo.zip"})
	if c != 200 || m["files"].(float64) != 3 {
		t.Fatalf("attach: %d %v", c, m)
	}
	z = readZip(t, get(ca, bundle))
	if !bytes.Equal(z["system-win95-v1.disk"], disk) {
		t.Error("o disco mudou ao ligar o disquete")
	}
	if !strings.Contains(string(z[".jsdos/dosbox.conf"]), "imgmount 0 install.img -t floppy") {
		t.Error("a conf deveria ligar o disquete")
	}
	fl := readFloppy(t, z["install.img"])
	if string(fl["SETUP.EXE"]) != "MZ-setup" || len(fl["DESKTOP.DA_"]) != 90000 || len(fl) != 3 {
		t.Errorf("disquete (a pasta ida/ deveria ter sido tirada): %v", keys(fl))
	}

	// trocar por outro
	outro := zipBytes(t, map[string][]byte{"LEIA.TXT": []byte("outro")}, zip.Store)
	put(ca, "/Programas/Instaladores/outro.zip", outro)
	if c, _ := vm(ca, "attach", map[string]string{"id": "win95", "zip": "/Programas/Instaladores/outro.zip"}); c != 200 {
		t.Fatalf("segundo attach: %d", c)
	}
	z = readZip(t, get(ca, bundle))
	if fl := readFloppy(t, z["install.img"]); len(fl) != 1 || string(fl["LEIA.TXT"]) != "outro" {
		t.Errorf("o disquete deveria ter sido trocado: %v", keys(fl))
	}
	if strings.Count(string(z[".jsdos/dosbox.conf"]), "imgmount 0") != 1 {
		t.Error("imgmount 0 duplicado")
	}

	// grande demais
	grande := zipBytes(t, map[string][]byte{"A.BIN": make([]byte, fdMaxBytes+10)}, zip.Deflate)
	put(ca, "/Programas/Instaladores/grande.zip", grande)
	if c, m := vm(ca, "attach", map[string]string{"id": "win95", "zip": "/Programas/Instaladores/grande.zip"}); c != 400 || !strings.Contains(fmt.Sprint(m["error"]), "1,4 MB") {
		t.Errorf("zip grande: %d %v", c, m)
	}
	if c, _ := vm(ca, "attach", map[string]string{"id": "nao-existe", "zip": "/Programas/Instaladores/outro.zip"}); c != 404 {
		t.Errorf("sistema inexistente deveria dar 404, deu %d", c)
	}

	// tirar o disquete
	if c, _ := vm(ca, "detach", map[string]string{"id": "win95"}); c != 200 {
		t.Fatalf("detach: %d", c)
	}
	z = readZip(t, get(ca, bundle))
	if _, ok := z["install.img"]; ok || strings.Contains(string(z[".jsdos/dosbox.conf"]), "imgmount 0") {
		t.Error("o disquete deveria ter saído")
	}
	if !bytes.Equal(z["system-win95-v1.disk"], disk) {
		t.Error("o disco mudou ao tirar o disquete")
	}

	// cada usuário só enxerga a própria pasta
	if c, _ := vm(cb, "attach", map[string]string{"id": "win95", "zip": "/Programas/Instaladores/outro.zip"}); c != 404 {
		t.Errorf("beto não deveria alcançar o sistema da ana, deu %d", c)
	}
	if c, _ := vm(cb, "prepare", map[string]string{"src": "../1/files/Programas/Instaladores/win95.jsdos", "id": "roubo"}); c != 404 {
		t.Errorf("caminho fora da pasta deveria dar 404, deu %d", c)
	}
	// sem sessão
	if w := e.req("POST", "/api/desk/vm/detach", map[string]string{"id": "win95"}, ""); w.Code != 401 {
		t.Errorf("sem sessão deveria dar 401, deu %d", w.Code)
	}
}

// Confere um pacote de sistema de verdade (grande, por isso só roda quando DESK_VM_PACOTE aponta para um .jsdos).
func TestVmPacoteReal(t *testing.T) {
	src := os.Getenv("DESK_VM_PACOTE")
	if src == "" {
		t.Skip("defina DESK_VM_PACOTE=caminho/do/sistema.jsdos para rodar")
	}
	dst := filepath.Join(t.TempDir(), "preparado.jsdos")
	t0 := time.Now()
	disks, err := vmRewrite(src, dst, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("preparado em %v, discos %v", time.Since(t0), disks)
	img, err := buildFloppy([]vmFile{{Name: "SETUP.EXE", Data: []byte("x")}}, "t")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := vmRewrite(dst, dst, img); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	z := readZip(t, b) // lê tudo e confere os CRCs
	for n := range z {
		if strings.HasSuffix(strings.ToLower(n), ".qcow2") {
			t.Errorf("sobrou %s", n)
		}
	}
	if !strings.Contains(string(z[".jsdos/dosbox.conf"]), "imgmount 0 install.img -t floppy") {
		t.Error("faltou o disquete na conf")
	}
	orig, _ := os.ReadFile(src)
	zo := readZip(t, orig)
	for n, d := range zo {
		if r := renameQcow(n); n != ".jsdos/dosbox.conf" && !bytes.Equal(z[r], d) {
			t.Errorf("%s mudou", n)
		}
	}
}
