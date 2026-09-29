// Padrões do painel. Para personalizar, crie config/settings.js (ignorado pelo git) com:
//   window.CD_SETTINGS_LOCAL = { calendar: {...}, traffic: {...} };  (só o que mudar; é mesclado sobre este arquivo)
// Tudo que estiver vazio faz o painel usar dados de EXEMPLO naquele bloco.
window.CD_SETTINGS = {
  location: { city: 'São Paulo', state: 'SP', lat: -23.5505, lon: -46.6333, timezone: 'America/Sao_Paulo' },

  // Agendas e trânsito são configurados no hub (server/hub.config.json): as URLs e a chave ficam só no servidor.
  // Sem hub, o painel mostra dados de exemplo nesses blocos.

  // Atalhos do rodapé (serviços na mesma máquina). {host} = http://endereço-da-máquina; "port" troca a porta.
  links: [
    { label: 'Jogos',  sub: 'WebRCade',  icon: 'gamepad', port: 8080, path: '/jogos/play/?feed={host}:8080/roms/feed.json' },
    { label: 'Conquistas', sub: 'PSN · Xbox · Steam · RA', icon: 'trophy', path: '/jogos.html' },
    { label: 'Música', sub: 'Navidrome', icon: 'music',   port: 4533, path: '/' },
    { label: 'Vídeos', sub: 'Pasta',     icon: 'film',    port: 8080, path: '/videos/' },
    { label: 'ROMs',   sub: 'Arquivos',  icon: 'folder',  port: 8080, path: '/roms/' }
  ],

  // Geladeira e Dispensa: itens que vencem em até N dias ficam em destaque âmbar (vencidos, em vermelho)
  estoque: { soonDays: 3 },

  refreshMinutes: 15,
  night: { from: 23, until: 5 }   // modo noturno: das 23h às 5h
};
