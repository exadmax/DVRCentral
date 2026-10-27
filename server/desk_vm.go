// Sistemas virtuais do Diogows: um Windows (3.x, 95, 98, ME) que roda no navegador pelo js-dos e guarda o disco alterado no servidor.
//
// O hub prepara o pacote .jsdos do sistema (copiando o zip sem recomprimir o disco) e monta o "disquete" com os arquivos de um programa:
//
//	prepare   registra o sistema: o disco .qcow2 vira .disk (o js-dos só libera o salvamento quando o dosbox.conf não cita .qcow2) e o
//	          dosbox.conf passa a iniciar o Windows direto (boot c:), sem o prompt do DOS
//	attach    monta um disquete FAT12 de 1,44 MB com os arquivos de um .zip e o liga como A: do sistema
//	detach    tira o disquete
//
// Tudo fica na pasta do usuário, em /Programas/Sistemas/<id>/. O que o Windows grava no disco é guardado pelo emulator.html.
package main

import (
	"archive/zip"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	vmDir        = "/Programas/Sistemas"
	vmInstallImg = "install.img"
	vmConfName   = ".jsdos/dosbox.conf"

	// disquete de 1,44 MB
	fdSectorSize = 512
	fdSectors    = 2880
	fdFATSectors = 9
	fdRootEntry  = 224
	fdFirstData  = 1 + 2*fdFATSectors + fdRootEntry*32/fdSectorSize // 33
	fdMaxCluster = fdSectors - fdFirstData + 1                      // último cluster usável (o primeiro é o 2)
	fdMaxBytes   = (fdSectors - fdFirstData) * fdSectorSize
)

var vmIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)

// ---------- dosbox.conf ----------

// vmConf reescreve o dosbox.conf de um pacote de sistema: renomeia os discos .qcow2 para .disk e troca a seção [autoexec] por
// "montar os discos, ligar o disquete (se houver) e dar boot". As outras seções ficam como estão. Rodar de novo sobre o resultado
// dá o mesmo resultado (é assim que o disquete é trocado). Devolve os nomes dos discos montados.
func vmConf(conf string, install bool) (string, []string, error) {
	conf = strings.ReplaceAll(conf, "\r\n", "\n")
	lines := strings.Split(conf, "\n")
	var out, mounts, disks []string
	inAuto, sawAuto := false, false
	for _, ln := range lines {
		t := strings.TrimSpace(ln)
		if strings.HasPrefix(t, "[") {
			if strings.EqualFold(t, "[autoexec]") {
				inAuto, sawAuto = true, true
				continue
			}
			if inAuto { // fim do [autoexec]: grava o novo e segue
				out = append(out, vmAutoexec(mounts, install)...)
				inAuto = false
			}
		}
		if !inAuto {
			out = append(out, ln)
			continue
		}
		f := strings.Fields(t)
		if len(f) >= 3 && strings.EqualFold(f[0], "imgmount") && !strings.EqualFold(f[2], vmInstallImg) {
			disk := renameQcow(f[2])
			disks = append(disks, disk)
			f[2] = disk
			mounts = append(mounts, strings.Join(f, " "))
		}
	}
	if inAuto {
		out = append(out, vmAutoexec(mounts, install)...)
	}
	if !sawAuto || len(mounts) == 0 {
		return "", nil, errors.New("o dosbox.conf do pacote não monta nenhum disco (imgmount); não parece um pacote de sistema operacional")
	}
	return strings.Join(out, "\n"), disks, nil
}

func vmAutoexec(mounts []string, install bool) []string {
	out := []string{"[autoexec]", "@echo off"}
	out = append(out, mounts...)
	if install {
		out = append(out, "imgmount 0 "+vmInstallImg+" -t floppy")
	}
	return append(out, "boot c:", "")
}

func renameQcow(name string) string {
	if len(name) > 6 && strings.EqualFold(name[len(name)-6:], ".qcow2") {
		return name[:len(name)-6] + ".disk"
	}
	return name
}

// ---------- pacote ----------

// vmRewrite copia o pacote src para dst trocando só o que muda: o dosbox.conf, o nome do disco e o disquete. As entradas grandes
// (o disco) são copiadas já comprimidas, então não há custo de recompressão. Devolve os discos montados.
func vmRewrite(src, dst string, install []byte) ([]string, error) {
	in, err := os.Open(src)
	if err != nil {
		return nil, err
	}
	defer in.Close()
	st, err := in.Stat()
	if err != nil {
		return nil, err
	}
	zr, err := zip.NewReader(in, st.Size())
	if err != nil {
		return nil, errors.New("o arquivo não é um pacote .jsdos válido (zip)")
	}
	var conf *zip.File
	names := map[string]bool{}
	for _, f := range zr.File {
		names[strings.ToLower(renameQcow(f.Name))] = true
		if f.Name == vmConfName {
			conf = f
		}
	}
	if conf == nil {
		return nil, errors.New("o pacote não tem .jsdos/dosbox.conf")
	}
	rc, err := conf.Open()
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(rc, 1<<20))
	rc.Close()
	if err != nil {
		return nil, err
	}
	newConf, disks, err := vmConf(string(raw), install != nil)
	if err != nil {
		return nil, err
	}
	for _, dsk := range disks {
		if !names[strings.ToLower(dsk)] {
			return nil, fmt.Errorf("o dosbox.conf monta %q, que não está dentro do pacote", dsk)
		}
	}

	tmp, err := os.CreateTemp(filepath.Dir(dst), ".vm-*.part")
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		tmp.Close()
		if !ok {
			os.Remove(tmp.Name())
		}
	}()
	zw := zip.NewWriter(tmp)
	for _, f := range zr.File {
		switch {
		case f.Name == vmInstallImg:
			continue
		case f.Name == vmConfName:
			w, err := zw.CreateHeader(&zip.FileHeader{Name: vmConfName, Method: zip.Deflate, Modified: f.Modified})
			if err == nil {
				_, err = io.WriteString(w, newConf)
			}
			if err != nil {
				return nil, err
			}
		default:
			h := f.FileHeader
			h.Name = renameQcow(h.Name)
			if f.Method == zip.Store || f.Method == zip.Deflate { // dá para copiar sem tocar nos dados
				raw, err := f.OpenRaw()
				if err != nil {
					return nil, err
				}
				w, err := zw.CreateRaw(&h)
				if err == nil {
					_, err = io.Copy(w, raw)
				}
				if err != nil {
					return nil, err
				}
				continue
			}
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			w, err := zw.CreateHeader(&zip.FileHeader{Name: h.Name, Method: zip.Deflate, Modified: f.Modified})
			if err == nil {
				_, err = io.Copy(w, rc)
			}
			rc.Close()
			if err != nil {
				return nil, err
			}
		}
	}
	if install != nil {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: vmInstallImg, Method: zip.Deflate, Modified: time.Now()})
		if err == nil {
			_, err = w.Write(install)
		}
		if err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	in.Close() // no Windows não dá para trocar um arquivo aberto
	if err := os.Rename(tmp.Name(), dst); err != nil {
		return nil, err
	}
	ok = true
	return disks, nil
}

// ---------- disquete FAT12 ----------

type vmFile struct {
	Name string // caminho dentro do zip, com "/"
	Data []byte
	Mod  time.Time
}

type fatNode struct {
	name  string // nome 8.3 (11 bytes, sem ponto)
	mod   time.Time
	data  []byte
	isDir bool
	kids  []*fatNode
	byLow map[string]*fatNode
}

// fatName converte um nome qualquer para o formato 8.3 do DOS (maiúsculas, sem espaços, ~N quando é preciso cortar).
func fatName(name string, used map[string]bool) string {
	clean := func(s string) string {
		var b strings.Builder
		for _, c := range strings.ToUpper(s) {
			switch {
			case c >= 'A' && c <= 'Z', c >= '0' && c <= '9', strings.ContainsRune("!#$%&'()-@^_`{}~", c):
				b.WriteRune(c)
			case c == ' ' || c == '.':
			default:
				b.WriteByte('_')
			}
		}
		return b.String()
	}
	i := strings.LastIndex(name, ".")
	base, ext := name, ""
	if i > 0 {
		base, ext = name[:i], name[i+1:]
	}
	b, e := clean(base), clean(ext)
	if b == "" {
		b = "_"
	}
	if len(e) > 3 {
		e = e[:3]
	}
	pad := func(b, e string) string { return fmt.Sprintf("%-8s%-3s", b, e) }
	if len(b) <= 8 && !used[pad(b, e)] {
		return pad(b, e)
	}
	for n := 1; ; n++ {
		suf := fmt.Sprintf("~%d", n)
		cut := b
		if len(cut) > 8-len(suf) {
			cut = cut[:8-len(suf)]
		}
		if cand := pad(cut+suf, e); !used[cand] {
			return cand
		}
	}
}

func fatTimeDate(t time.Time) (uint16, uint16) {
	if t.Year() < 1980 || t.IsZero() {
		t = time.Date(1996, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	return uint16(t.Hour()<<11 | t.Minute()<<5 | t.Second()/2), uint16((t.Year()-1980)<<9 | int(t.Month())<<5 | t.Day())
}

// buildFloppy monta uma imagem de disquete de 1,44 MB (FAT12) com os arquivos, mantendo as subpastas.
func buildFloppy(files []vmFile, label string) ([]byte, error) {
	root := &fatNode{isDir: true, byLow: map[string]*fatNode{}}
	used := map[*fatNode]map[string]bool{root: {}}
	for _, f := range files {
		parts := strings.Split(strings.Trim(f.Name, "/"), "/")
		cur := root
		for i, p := range parts {
			last := i == len(parts)-1
			key := strings.ToLower(p)
			n := cur.byLow[key]
			if n == nil {
				n = &fatNode{name: fatName(p, used[cur]), isDir: !last, mod: f.Mod, byLow: map[string]*fatNode{}}
				used[cur][n.name] = true
				cur.byLow[key] = n
				cur.kids = append(cur.kids, n)
				if !last {
					used[n] = map[string]bool{}
				}
			}
			if last {
				n.data = f.Data
				n.mod = f.Mod
			}
			cur = n
		}
	}
	img := make([]byte, fdSectors*fdSectorSize)
	fat := make([]uint16, fdMaxCluster+1)
	fat[0], fat[1] = 0xFF0, 0xFFF
	next := 2
	alloc := func(nbytes int) (int, error) {
		n := (nbytes + fdSectorSize - 1) / fdSectorSize
		if n == 0 {
			return 0, nil
		}
		if next+n-1 > fdMaxCluster {
			return 0, fmt.Errorf("os arquivos não cabem no disquete virtual de 1,44 MB")
		}
		first := next
		for i := 0; i < n; i++ {
			if i < n-1 {
				fat[next+i] = uint16(next + i + 1)
			} else {
				fat[next+i] = 0xFFF
			}
		}
		next += n
		return first, nil
	}
	put := func(cluster int, data []byte) {
		for i := 0; i*fdSectorSize < len(data); i++ {
			end := min((i+1)*fdSectorSize, len(data))
			copy(img[(fdFirstData+cluster-2+i)*fdSectorSize:], data[i*fdSectorSize:end])
		}
	}
	entry := func(n *fatNode, cluster int) []byte {
		e := make([]byte, 32)
		copy(e, n.name)
		attr := byte(0x20)
		size := uint32(len(n.data))
		if n.isDir {
			attr, size = 0x10, 0
		}
		e[11] = attr
		tm, dt := fatTimeDate(n.mod)
		binary.LittleEndian.PutUint16(e[22:], tm)
		binary.LittleEndian.PutUint16(e[24:], dt)
		binary.LittleEndian.PutUint16(e[26:], uint16(cluster))
		binary.LittleEndian.PutUint32(e[28:], size)
		return e
	}
	var emit func(dir *fatNode, self, parent int, isRoot bool) ([]byte, error)
	emit = func(dir *fatNode, self, parent int, isRoot bool) ([]byte, error) {
		var ents []byte
		if !isRoot {
			dot := &fatNode{name: ".          ", isDir: true, mod: dir.mod}
			dotdot := &fatNode{name: "..         ", isDir: true, mod: dir.mod}
			ents = append(ents, entry(dot, self)...)
			ents = append(ents, entry(dotdot, parent)...)
		}
		sort.SliceStable(dir.kids, func(i, j int) bool { return dir.kids[i].name < dir.kids[j].name })
		for _, k := range dir.kids {
			var c int
			var err error
			if k.isDir {
				c, err = alloc(max(1, (len(k.kids)+2)*32))
				if err != nil {
					return nil, err
				}
				sub, err := emit(k, c, self, false)
				if err != nil {
					return nil, err
				}
				put(c, sub)
			} else {
				if c, err = alloc(len(k.data)); err != nil {
					return nil, err
				}
				put(c, k.data)
			}
			ents = append(ents, entry(k, c)...)
		}
		return ents, nil
	}
	rootEnts, err := emit(root, 0, 0, true)
	if err != nil {
		return nil, err
	}
	if len(rootEnts) > fdRootEntry*32 {
		return nil, errors.New("arquivos demais na raiz do disquete")
	}

	bs := img[:fdSectorSize]
	copy(bs, []byte{0xEB, 0x3C, 0x90})
	copy(bs[3:], "MSDOS5.0")
	binary.LittleEndian.PutUint16(bs[11:], fdSectorSize)
	bs[13] = 1
	binary.LittleEndian.PutUint16(bs[14:], 1)
	bs[16] = 2
	binary.LittleEndian.PutUint16(bs[17:], fdRootEntry)
	binary.LittleEndian.PutUint16(bs[19:], fdSectors)
	bs[21] = 0xF0
	binary.LittleEndian.PutUint16(bs[22:], fdFATSectors)
	binary.LittleEndian.PutUint16(bs[24:], 18)
	binary.LittleEndian.PutUint16(bs[26:], 2)
	bs[38] = 0x29
	binary.LittleEndian.PutUint32(bs[39:], 0x1D5C0A11)
	copy(bs[43:54], fmt.Sprintf("%-11s", strings.ToUpper(label)))
	copy(bs[54:62], "FAT12   ")
	bs[510], bs[511] = 0x55, 0xAA

	ft := make([]byte, fdFATSectors*fdSectorSize)
	for c := 0; c < next; c++ {
		v, o := fat[c], c*3/2
		if c%2 == 0 {
			ft[o], ft[o+1] = byte(v), (ft[o+1]&0xF0)|byte(v>>8)
		} else {
			ft[o], ft[o+1] = (ft[o]&0x0F)|byte(v&0xF)<<4, byte(v>>4)
		}
	}
	copy(img[fdSectorSize:], ft)
	copy(img[fdSectorSize+len(ft):], ft)
	copy(img[(1+2*fdFATSectors)*fdSectorSize:], rootEnts)
	return img, nil
}

// vmFilesFromZip lê os arquivos de um .zip para o disquete. Se tudo estiver dentro de uma única pasta, ela é removida (o programa
// fica na raiz do disquete, como num disquete de instalação de verdade). Recusa o que passar da capacidade do disquete.
func vmFilesFromZip(r io.ReaderAt, size int64) ([]vmFile, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, errors.New("o arquivo não é um .zip válido")
	}
	var list []*zip.File
	var total uint64
	for _, f := range zr.File {
		n := strings.ReplaceAll(f.Name, "\\", "/")
		if f.FileInfo().IsDir() || strings.HasPrefix(n, "__MACOSX/") || strings.Contains(n, "..") {
			continue
		}
		list = append(list, f)
		total += f.UncompressedSize64
	}
	if len(list) == 0 {
		return nil, errors.New("o zip está vazio")
	}
	if total > fdMaxBytes {
		return nil, fmt.Errorf("o programa tem %.1f MB e o disquete virtual comporta 1,4 MB (programas maiores ainda não são suportados)", float64(total)/1048576)
	}
	top := ""
	for i, f := range list {
		first, _, hasDir := strings.Cut(strings.ReplaceAll(f.Name, "\\", "/"), "/")
		if !hasDir || (i > 0 && first != top) {
			top = ""
			break
		}
		top = first
	}
	var out []vmFile
	for _, f := range list {
		n := strings.ReplaceAll(f.Name, "\\", "/")
		if top != "" {
			n = strings.TrimPrefix(n, top+"/")
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(rc, fdMaxBytes+1))
		rc.Close()
		if err != nil {
			return nil, err
		}
		out = append(out, vmFile{Name: n, Data: data, Mod: f.Modified})
	}
	return out, nil
}

// ---------- rotas ----------

var vmMu sync.Mutex // um preparo por vez: reescrever um pacote grande não combina com dois ao mesmo tempo

func (d *deskAPI) registerVM(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/desk/vm/prepare", d.guard(false, false, d.vmPrepare))
	mux.HandleFunc("POST /api/desk/vm/attach", d.guard(false, false, d.vmAttach))
	mux.HandleFunc("POST /api/desk/vm/detach", d.guard(false, false, d.vmDetach))
}

func (d *deskAPI) vmHome(u *DeskUser) (localFS, error) {
	root := filepath.Join(d.userDir(u.ID), "files")
	if err := os.MkdirAll(root, 0o755); err != nil {
		return localFS{}, fsErr(http.StatusInternalServerError, "não foi possível preparar a sua pasta")
	}
	return localFS{root: root}, nil
}

func vmBundlePath(id string) string { return path.Join(vmDir, id, id+".jsdos") }

// vmPrepare: { src: "/Programas/Instaladores/win.jsdos", id: "win311" } -> /Programas/Sistemas/win311/win311.jsdos
func (d *deskAPI) vmPrepare(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in struct{ Src, ID string }
	if !deskDecode(w, r, &in) {
		return
	}
	if !vmIDRe.MatchString(in.ID) {
		deskErr(w, http.StatusBadRequest, "identificador inválido (use letras minúsculas, números e hífen)")
		return
	}
	home, err := d.vmHome(u)
	if err != nil {
		fsFail(w, err)
		return
	}
	src, err := home.real(in.Src)
	if err != nil {
		fsFail(w, err)
		return
	}
	if st, err := os.Stat(src); err != nil || !st.Mode().IsRegular() {
		deskErr(w, http.StatusNotFound, "pacote não encontrado na sua pasta")
		return
	}
	dst, err := home.real(vmBundlePath(in.ID))
	if err != nil {
		fsFail(w, err)
		return
	}
	vmMu.Lock()
	defer vmMu.Unlock()
	if _, err := os.Stat(dst); err == nil {
		deskErr(w, http.StatusConflict, "já existe um sistema com esse identificador")
		return
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		fsFail(w, osErr(err))
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	disks, err := vmRewrite(src, dst, nil)
	if err != nil {
		os.Remove(filepath.Dir(dst)) // só some se estiver vazia
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeStatus(w, http.StatusOK, map[string]any{"ok": true, "bundle": vmBundlePath(in.ID), "disks": disks})
}

// vmAttach: { id: "win311", zip: "/Programas/Instaladores/jogo.zip" } liga um disquete com os arquivos do zip como A: do sistema.
func (d *deskAPI) vmAttach(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in struct{ ID, Zip string }
	if !deskDecode(w, r, &in) {
		return
	}
	if !vmIDRe.MatchString(in.ID) {
		deskErr(w, http.StatusBadRequest, "identificador inválido")
		return
	}
	home, err := d.vmHome(u)
	if err != nil {
		fsFail(w, err)
		return
	}
	zp, err := home.real(in.Zip)
	if err != nil {
		fsFail(w, err)
		return
	}
	f, err := os.Open(zp)
	if err != nil {
		fsFail(w, osErr(err))
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		deskErr(w, http.StatusNotFound, "arquivo não encontrado na sua pasta")
		return
	}
	files, err := vmFilesFromZip(f, st.Size())
	if err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	img, err := buildFloppy(files, "INSTALAR")
	if err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	bundle, err := home.real(vmBundlePath(in.ID))
	if err != nil {
		fsFail(w, err)
		return
	}
	vmMu.Lock()
	defer vmMu.Unlock()
	if _, err := os.Stat(bundle); err != nil {
		deskErr(w, http.StatusNotFound, "sistema não encontrado")
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	if _, err := vmRewrite(bundle, bundle, img); err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var bytesUsed int
	for _, f := range files {
		bytesUsed += len(f.Data)
	}
	writeStatus(w, http.StatusOK, map[string]any{"ok": true, "files": len(files), "bytes": bytesUsed})
}

// vmDetach: { id } tira o disquete do sistema.
func (d *deskAPI) vmDetach(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in struct{ ID string }
	if !deskDecode(w, r, &in) {
		return
	}
	if !vmIDRe.MatchString(in.ID) {
		deskErr(w, http.StatusBadRequest, "identificador inválido")
		return
	}
	home, err := d.vmHome(u)
	if err != nil {
		fsFail(w, err)
		return
	}
	bundle, err := home.real(vmBundlePath(in.ID))
	if err != nil {
		fsFail(w, err)
		return
	}
	vmMu.Lock()
	defer vmMu.Unlock()
	if _, err := os.Stat(bundle); err != nil {
		deskErr(w, http.StatusNotFound, "sistema não encontrado")
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	if _, err := vmRewrite(bundle, bundle, nil); err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}
