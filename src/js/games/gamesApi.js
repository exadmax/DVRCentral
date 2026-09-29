(function (CD) {
  // Dados do subsistema Conquistas: vêm do hub (/api/games), que guarda as chaves das 4 plataformas.
  // Sem hub (ou plataforma sem chave configurada) o dashboard mostra dados de EXEMPLO naquele bloco.

  const PLATFORMS = {
    psn:   { name: 'PlayStation', short: 'PSN',   color: '#4C7DF0', unit: 'troféus' },
    xbox:  { name: 'Xbox',        short: 'Xbox',  color: '#1FAF6E', unit: 'conquistas' },
    steam: { name: 'Steam',       short: 'Steam', color: '#9B6FF0', unit: 'conquistas' },
    retro: { name: 'RetroAchievements', short: 'RA', color: '#C9820A', unit: 'conquistas' }
  };
  const ORDER = ['psn', 'xbox', 'steam', 'retro'];

  // ---------- exemplo ----------
  function daysAgo(n, h) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h || 21, 10, 0, 0); return d.toISOString(); }
  function g(name, system, earned, total, last, playMin, award, extra) {
    return Object.assign({ id: name, name: name, system: system, earned: earned, total: total, pct: total ? Math.round(earned * 1000 / total) / 10 : 0,
      lastPlayed: daysAgo(last), playMin: playMin, award: award }, extra || {});
  }
  function u(game, name, desc, days, extra) { return Object.assign({ game: game, name: name, desc: desc, date: daysAgo(days, 20 + days % 3) }, extra || {}); }

  function demo() {
    return {
      psn: { account: 'seu-usuario', stats: { level: 312, levelProgress: 48, achievements: 2146, perfect: 14, games: 87, hours: 1480,
        grades: { platinum: 14, gold: 131, silver: 402, bronze: 1599 } },
        games: [
          g('Astro Bot', 'PS5', 48, 48, 3, 1260, 'platina', { grades: { platinum: 1, gold: 4, silver: 12, bronze: 31 } }),
          g('Marvel\'s Spider-Man 2', 'PS5', 39, 42, 12, 2280),
          g('God of War Ragnarök', 'PS5', 36, 36, 40, 3400, 'platina'),
          g('Elden Ring', 'PS5', 27, 42, 65, 5200),
          g('Bloodborne', 'PS4', 12, 34, 190, 1900),
          g('Final Fantasy VII Rebirth', 'PS5', 58, 60, 25, 4300),
          g('Gran Turismo 7', 'PS5', 31, 59, 90, 1720),
          g('The Last of Us Part I', 'PS5', 57, 57, 300, 1500, 'platina')
        ],
        recent: [u('Astro Bot', 'Astro Bot', 'Todos os troféus obtidos', 3, { kind: 'platinum', rarity: 18.2 }),
          u('Astro Bot', 'Colecionador galáctico', 'Encontre todos os bots', 3, { kind: 'gold', rarity: 21.5 }),
          u('Marvel\'s Spider-Man 2', 'Balanço perfeito', 'Complete 20 desafios', 12, { kind: 'silver', rarity: 34 }),
          u('Final Fantasy VII Rebirth', 'Rei do Queen\'s Blood', 'Vença o torneio', 25, { kind: 'gold', rarity: 9.8 })] },
      xbox: { account: 'Omega Diogo', stats: { gamerscore: 48210, achievements: 2011, perfect: 22, games: 164 },
        games: [
          g('Forza Horizon 5', 'Xbox Series', 121, 176, 2, 0, null, { score: 1850, scoreTotal: 3000 }),
          g('Halo Infinite', 'Xbox Series', 119, 119, 60, 0, '100%', { score: 1600, scoreTotal: 1600 }),
          g('Starfield', 'Xbox Series', 34, 50, 110, 0, null, { score: 670, scoreTotal: 1000 }),
          g('Gears of War 2', 'Xbox 360', 49, 49, 700, 0, '100%', { score: 1750, scoreTotal: 1750 }),
          g('Hi-Fi Rush', 'Xbox Series', 58, 60, 45, 0),
          g('Mass Effect', 'Xbox 360', 49, 49, 1200, 0, '100%')
        ],
        recent: [u('Forza Horizon 5', 'Colecionador de clássicos', 'Compre 10 carros clássicos', 2, { points: 30, rarity: 12.1 }),
          u('Forza Horizon 5', 'Rota do sol', 'Vença uma corrida ao amanhecer', 6, { points: 20, rarity: 40.3 }),
          u('Hi-Fi Rush', 'No ritmo', 'Complete uma luta com rank S', 45, { points: 50, rarity: 7.4 })] },
      steam: { account: 'seu-usuario', stats: { level: 42, games: 412, played: 188, achievements: 1733, perfect: 19, hours: 2310 },
        games: [
          g('Hades II', 'PC', 38, 49, 1, 3100),
          g('Baldur\'s Gate 3', 'PC', 41, 54, 30, 9800),
          g('Hollow Knight', 'PC', 63, 63, 400, 3200, '100%'),
          g('Stardew Valley', 'PC', 38, 49, 150, 6200),
          g('Portal 2', 'PC', 51, 51, 900, 1100, '100%'),
          g('Celeste', 'PC', 31, 32, 520, 1400)
        ],
        recent: [u('Hades II', 'Ferreira do submundo', 'Aprimore uma arma ao máximo', 1),
          u('Hades II', 'Madrugada', 'Derrote Chronos', 4), u('Baldur\'s Gate 3', 'Sangue e ouro', 'Termine o Ato 2', 30)] },
      retro: { account: 'seu-usuario', stats: { points: 8430, truePoints: 21870, rank: 12450, games: 58, achievements: 912, perfect: 9, beaten: 17 },
        games: [
          g('Super Metroid', 'SNES/Super Famicom', 58, 58, 8, 0, 'masterizado', { score: 510, scoreTotal: 510 }),
          g('Castlevania: Symphony of the Night', 'PlayStation', 41, 72, 20, 0, 'zerado'),
          g('Sonic the Hedgehog', 'Genesis/Mega Drive', 27, 27, 95, 0, 'masterizado'),
          g('Pokémon Emerald', 'Game Boy Advance', 64, 102, 140, 0, 'zerado'),
          g('Chrono Trigger', 'SNES/Super Famicom', 36, 77, 210, 0),
          g('Super Mario 64', 'Nintendo 64', 44, 44, 330, 0, 'masterizado')
        ],
        recent: [u('Super Metroid', 'Metroid caçado', 'Termine com 100% dos itens', 8, { points: 25 }),
          u('Castlevania: Symphony of the Night', 'Castelo invertido', 'Entre no castelo invertido', 20, { points: 10 })] }
    };
  }

  async function load(hub, refresh) {
    let res = null;
    if (hub) {
      try { res = await CD.util.getJson(hub + '/api/games' + (refresh ? '?refresh=1' : ''), 20000); } catch (e) { res = null; }
    }
    const d = demo(), byId = {};
    ((res && res.platforms) || []).forEach(p => { byId[p.id] = p; });
    const list = ORDER.map(id => {
      const p = byId[id], meta = PLATFORMS[id];
      const real = p && p.configured && p.games && p.games.length;
      const base = real ? p : Object.assign({}, d[id], { error: p && p.configured ? p.error : '', configured: !!(p && p.configured), needsLogin: !!(p && p.needsLogin) });
      return Object.assign({ stats: {}, games: [], recent: [] }, base, { id: id, meta: meta, demo: !real });
    });
    return { hub: !!res, refreshing: !!(res && res.refreshing), platforms: list };
  }

  CD.gamesApi = { load: load, PLATFORMS: PLATFORMS, ORDER: ORDER };
})(window.CD = window.CD || {});
