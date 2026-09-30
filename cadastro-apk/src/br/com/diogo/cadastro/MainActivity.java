package br.com.diogo.cadastro;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Cadastro rápido da Geladeira/Dispensa e dos Serviços, direto na API do hub de casa (só intranet, sem login).
 * Uma tela só, montada por código, e um formulário genérico guiado pelas tabelas de campos abaixo.
 */
public class MainActivity extends Activity {
    private static final String HUB_PADRAO = "http://192.168.0.10";
    private static final String[] LOCAIS = {"geladeira", "freezer", "dispensa"};

    // chave da API, rótulo, tipo (t = texto, n = número, d = data, l = local)
    private static final String[][] ESTOQUE = {
        {"nome", "Nome", "t"}, {"quantidade", "Quantidade", "n"}, {"pesoKg", "Peso (kg)", "n"},
        {"validade", "Validade (AAAA-MM-DD)", "d"}, {"local", "Local", "l"}};
    private static final String[][] SERVICOS = {
        {"nome", "Nome / empresa", "t"}, {"tipoServico", "Tipo de serviço", "t"}, {"contato", "Contato", "t"},
        {"indicacao", "Indicação", "t"}, {"servico", "Serviço", "t"}, {"obs", "Obs", "t"}};

    private interface Retorno { void ok(String corpo); }

    private SharedPreferences prefs;
    private boolean emEstoque = true;
    private final List<JSONObject> dados = new ArrayList<>();
    private final List<JSONObject> visiveis = new ArrayList<>();
    private ArrayAdapter<String> adapter;
    private Button abaEstoque, abaServicos;
    private EditText busca;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("cfg", Context.MODE_PRIVATE);

        LinearLayout raiz = new LinearLayout(this);
        raiz.setOrientation(LinearLayout.VERTICAL);
        raiz.setPadding(dp(8), dp(24), dp(8), dp(8));

        LinearLayout topo = new LinearLayout(this);
        abaEstoque = botao("Geladeira", v -> trocar(true));
        abaServicos = botao("Serviços", v -> trocar(false));
        topo.addView(abaEstoque, peso());
        topo.addView(abaServicos, peso());
        topo.addView(botao("⚙", v -> configurar()));
        raiz.addView(topo);

        busca = new EditText(this);
        busca.setHint("Buscar");
        busca.setSingleLine();
        busca.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int c, int d) { }
            public void onTextChanged(CharSequence s, int a, int c, int d) { filtrar(); }
            public void afterTextChanged(Editable s) { }
        });
        raiz.addView(busca);

        adapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, new ArrayList<String>());
        ListView lv = new ListView(this);
        lv.setAdapter(adapter);
        lv.setOnItemClickListener((p, v, i, id) -> formulario(visiveis.get(i)));
        raiz.addView(lv, new LinearLayout.LayoutParams(-1, 0, 1));

        raiz.addView(botao("+ Novo", v -> formulario(null)), new LinearLayout.LayoutParams(-1, -2));
        setContentView(raiz);
        trocar(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        carregar();
    }

    // ---------- abas e lista ----------

    private String[][] campos() { return emEstoque ? ESTOQUE : SERVICOS; }
    private String rota() { return emEstoque ? "/api/estoque" : "/api/contatos"; }

    private void trocar(boolean estoque) {
        emEstoque = estoque;
        abaEstoque.setEnabled(!estoque);
        abaServicos.setEnabled(estoque);
        busca.setText("");
        dados.clear();
        filtrar();
        carregar();
    }

    private void carregar() {
        final boolean aba = emEstoque;
        http("GET", rota(), null, corpo -> {
            if (aba != emEstoque) return; // trocou de aba enquanto carregava
            dados.clear();
            try {
                JSONArray a = new JSONArray(corpo);
                for (int i = 0; i < a.length(); i++) dados.add(a.getJSONObject(i));
            } catch (Exception e) {
                aviso("Resposta inválida do hub");
            }
            filtrar();
        });
    }

    private void filtrar() {
        String q = busca.getText().toString().trim().toLowerCase();
        visiveis.clear();
        adapter.clear();
        for (JSONObject o : dados) {
            String t = resumo(o);
            if (!q.isEmpty() && !t.toLowerCase().contains(q)) continue;
            visiveis.add(o);
            adapter.add(t);
        }
    }

    private String resumo(JSONObject o) {
        StringBuilder s = new StringBuilder(o.optString("nome"));
        if (emEstoque) {
            juntar(s, o.optString("local"));
            if (!o.isNull("quantidade")) juntar(s, num(o, "quantidade") + " un");
            if (!o.isNull("pesoKg")) juntar(s, num(o, "pesoKg") + " kg");
            if (!o.isNull("validade")) juntar(s, "vence " + o.optString("validade"));
        } else {
            juntar(s, o.optString("tipoServico"));
            juntar(s, o.optString("contato"));
        }
        return s.toString();
    }

    private static void juntar(StringBuilder s, String parte) {
        if (parte.isEmpty()) return;
        s.append(s.indexOf("\n") < 0 ? "\n" : " · ").append(parte);
    }

    // ---------- formulário (novo / editar / excluir) ----------

    private void formulario(final JSONObject item) {
        final String[][] cs = campos();
        LinearLayout caixa = new LinearLayout(this);
        caixa.setOrientation(LinearLayout.VERTICAL);
        caixa.setPadding(dp(20), dp(8), dp(20), 0);
        final View[] vs = new View[cs.length];
        for (int i = 0; i < cs.length; i++) {
            TextView rot = new TextView(this);
            rot.setText(cs[i][1]);
            caixa.addView(rot);
            String tipo = cs[i][2];
            String atual = item == null || item.isNull(cs[i][0]) ? "" : item.optString(cs[i][0]);
            if (tipo.equals("l")) {
                Spinner sp = new Spinner(this);
                sp.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, LOCAIS));
                for (int j = 0; j < LOCAIS.length; j++) if (LOCAIS[j].equals(atual)) sp.setSelection(j);
                vs[i] = sp;
            } else {
                EditText et = new EditText(this);
                et.setInputType(tipo.equals("n") ? InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL
                        : tipo.equals("d") ? InputType.TYPE_CLASS_DATETIME | InputType.TYPE_DATETIME_VARIATION_DATE
                        : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
                et.setText(tipo.equals("n") && item != null && !item.isNull(cs[i][0]) ? num(item, cs[i][0]) : atual);
                vs[i] = et;
            }
            caixa.addView(vs[i]);
        }
        ScrollView sv = new ScrollView(this);
        sv.addView(caixa);

        AlertDialog.Builder bd = new AlertDialog.Builder(this)
                .setTitle(item == null ? "Novo" : "Editar")
                .setView(sv)
                .setPositiveButton("Salvar", null)
                .setNegativeButton("Cancelar", null);
        if (item != null) bd.setNeutralButton("Excluir", null);
        final AlertDialog d = bd.create();
        d.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        d.show();

        // listeners próprios: o diálogo só fecha quando a API aceita
        d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                JSONObject j = new JSONObject();
                for (int i = 0; i < cs.length; i++) {
                    String tipo = cs[i][2];
                    String txt = vs[i] instanceof Spinner ? (String) ((Spinner) vs[i]).getSelectedItem()
                            : ((EditText) vs[i]).getText().toString().trim();
                    if (tipo.equals("n")) j.put(cs[i][0], txt.isEmpty() ? JSONObject.NULL : (Object) Double.valueOf(txt.replace(',', '.')));
                    else if (tipo.equals("d")) j.put(cs[i][0], txt.isEmpty() ? JSONObject.NULL : (Object) txt);
                    else j.put(cs[i][0], txt);
                }
                String caminho = item == null ? rota() : rota() + "/" + item.optLong("id");
                http(item == null ? "POST" : "PUT", caminho, j.toString(), r -> { d.dismiss(); carregar(); });
            } catch (Exception e) {
                aviso("Número inválido");
            }
        });
        if (item != null) {
            d.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v ->
                new AlertDialog.Builder(this).setMessage("Excluir \"" + item.optString("nome") + "\"?")
                    .setNegativeButton("Não", null)
                    .setPositiveButton("Excluir", (x, w) ->
                        http("DELETE", rota() + "/" + item.optLong("id"), null, r -> { d.dismiss(); carregar(); }))
                    .show());
        }
    }

    private void configurar() {
        final EditText et = new EditText(this);
        et.setSingleLine();
        et.setText(hub());
        new AlertDialog.Builder(this).setTitle("Endereço do hub").setView(et)
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Salvar", (x, w) -> {
                String u = et.getText().toString().trim();
                if (!u.isEmpty() && !u.startsWith("http")) u = "http://" + u;
                prefs.edit().putString("hub", u.replaceAll("/+$", "")).apply();
                carregar();
            }).show();
    }

    // ---------- rede ----------

    private String hub() { return prefs.getString("hub", HUB_PADRAO); }

    /** Chamada à API numa thread à parte; o retorno (ou o aviso de erro) volta na thread da tela. */
    private void http(final String metodo, final String caminho, final String corpo, final Retorno fim) {
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(hub() + caminho).openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(10000);
                c.setRequestMethod(metodo);
                if (corpo != null) {
                    c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "application/json");
                    c.getOutputStream().write(corpo.getBytes("UTF-8"));
                }
                int cod = c.getResponseCode();
                final String txt = ler(cod < 400 ? c.getInputStream() : c.getErrorStream());
                if (cod >= 400) {
                    String m;
                    try { m = new JSONObject(txt).getString("error"); } catch (Exception e) { m = "Erro " + cod; }
                    throw new Exception(m);
                }
                runOnUiThread(() -> fim.ok(txt));
            } catch (final Exception e) {
                String m = e.getMessage();
                aviso(e instanceof java.io.IOException ? "Sem conexão com o hub (" + hub() + ")" : m);
            }
        }).start();
    }

    private static String ler(InputStream in) throws java.io.IOException {
        if (in == null) return "";
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        for (int n; (n = in.read(buf)) > 0; ) o.write(buf, 0, n);
        in.close();
        return o.toString("UTF-8");
    }

    // ---------- utilidades ----------

    private void aviso(final String m) {
        runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show());
    }

    private static String num(JSONObject o, String k) {
        double d = o.optDouble(k);
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }

    private Button botao(String t, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(t);
        b.setOnClickListener(l);
        return b;
    }

    private static LinearLayout.LayoutParams peso() { return new LinearLayout.LayoutParams(0, -2, 1); }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
