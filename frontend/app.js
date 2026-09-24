/**
 * PIRA-TACTICAL Dashboard - Frontend Logic
 * Arquitetura Reativa Mobile-First para Motoristas em Piracicaba-SP
 */

// Estado Global da Aplicação
const appState = {
  currentData: null,
  simulatedHour: null,
  dayOffset: 0, // 0 = Hoje, 1 = Amanhã, etc.
  audioAlertsEnabled: true,
  activeMapFilter: 'ALL',
  activeRiskCategory: 'ALL',
  map: null,
  markersLayer: null,
  polygonsLayer: null,
  currentTileLayerKey: 'street',
  tileLayers: {},
  isMapExpanded: false
};

// Inicialização
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    lucide.createIcons();
  }
  
  // Sincroniza slider com a hora real atual
  const currentRealHour = new Date().getHours();
  const timeSlider = document.getElementById("time-slider");
  if (timeSlider) {
    timeSlider.value = currentRealHour;
  }

  startHudClock();
  initMap();
  fetchFeed();
  calculateTripViability();

  // Auto-refresh a cada 60 segundos
  setInterval(() => {
    if (appState.simulatedHour === null && appState.dayOffset === 0) {
      fetchFeed(false);
    }
  }, 60000);
});

// Modal de Ajuda
function toggleHelpModal() {
  const modal = document.getElementById("help-modal");
  if (modal) {
    modal.classList.toggle("hidden");
  }
}

// Relógio em tempo real no topo
function startHudClock() {
  const clockEl = document.getElementById("hud-clock");
  setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    clockEl.innerText = `${timeStr} • PIRACICABA-SP`;
  }, 1000);
}

// Inicializa o Mapa Leaflet com Camadas Cristalinas e Sem Watermark
function initMap() {
  const mapEl = document.getElementById("tactical-map");
  if (!mapEl) return;

  // Centro de Piracicaba (Praça José Bonifácio / Centro)
  appState.map = L.map("tactical-map", {
    zoomControl: true,
    attributionControl: false
  }).setView([-22.7253, -47.6492], 13);

  // Provedores de Tiles 100% gratuitos e de alta resolução
  appState.tileLayers = {
    // 1. OpenStreetMap padrão: Nomes de ruas, avenidas, bairros e pontos de interesse perfeitamente visíveis
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c']
    }),
    // 2. Modo Dark Nítido (OpenStreetMap com renderização suave e sem necessidade de API key)
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }),
    // 3. Satélite Real de Alta Resolução (Esri World Imagery)
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    })
  };

  // Camada padrão inicial: Ruas detalhadas
  appState.tileLayers.street.addTo(appState.map);

  appState.markersLayer = L.layerGroup().addTo(appState.map);
  appState.polygonsLayer = L.layerGroup().addTo(appState.map);
}

// Alterna entre Camadas do Mapa (Ruas, Dark, Satélite)
function switchMapLayer(layerKey, btnEl) {
  if (!appState.map || !appState.tileLayers[layerKey]) return;

  // Remove camada anterior
  Object.values(appState.tileLayers).forEach(layer => {
    if (appState.map.hasLayer(layer)) {
      appState.map.removeLayer(layer);
    }
  });

  // Adiciona a nova camada selecionada
  appState.tileLayers[layerKey].addTo(appState.map);
  appState.currentTileLayerKey = layerKey;

  // Atualiza visual dos botões
  document.querySelectorAll('.map-layer-btn').forEach(btn => {
    btn.className = "map-layer-btn px-2 py-1 rounded bg-pira-800 text-slate-300 border border-pira-700 hover:text-white";
  });
  if (btnEl) {
    btnEl.className = "map-layer-btn px-2 py-1 rounded bg-pira-emerald text-black font-bold border border-pira-emerald shadow";
  }
}

// Recentralizar mapa em Piracicaba
function recenterMap() {
  if (!appState.map) return;
  appState.map.flyTo([-22.7253, -47.6492], 13, { duration: 1.2 });
}

// Focar em um local específico com zoom e abrir popup
function focusMapLocation(lat, lng, name) {
  if (!appState.map) return;
  appState.map.flyTo([lat, lng], 16, { duration: 1.2 });

  // Procurar o marcador correspondente para abrir popup automaticamente
  if (appState.markersLayer) {
    appState.markersLayer.eachLayer(layer => {
      if (layer.getLatLng) {
        const p = layer.getLatLng();
        if (Math.abs(p.lat - lat) < 0.001 && Math.abs(p.lng - lng) < 0.001) {
          setTimeout(() => {
            layer.openPopup();
          }, 1250);
        }
      }
    });
  }
}

// Alternar Altura / Expandir Mapa
function toggleMapHeight() {
  const mapEl = document.getElementById("tactical-map");
  const iconEl = document.getElementById("icon-map-size");
  if (!mapEl) return;

  appState.isMapExpanded = !appState.isMapExpanded;
  if (appState.isMapExpanded) {
    mapEl.classList.remove("h-80", "sm:h-96");
    mapEl.classList.add("h-[540px]");
    if (iconEl) iconEl.setAttribute("data-lucide", "minimize-2");
  } else {
    mapEl.classList.remove("h-[540px]");
    mapEl.classList.add("h-80", "sm:h-96");
    if (iconEl) iconEl.setAttribute("data-lucide", "maximize-2");
  }

  setTimeout(() => {
    if (appState.map) {
      appState.map.invalidateSize();
    }
    if (window.lucide) lucide.createIcons();
  }, 310);
}

// Consumo da API / Fallback Inteligente
async function fetchFeed(showLoading = true) {
  const listEl = document.getElementById("ranked-cards-list");
  if (showLoading && listEl) {
    listEl.innerHTML = `
      <div class="bg-pira-850 p-4 rounded-xl border border-pira-700/60 text-center py-8">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-pira-emerald mb-2"></div>
        <p class="text-xs text-slate-400 font-mono">Consolidando agenda de Piracicaba...</p>
      </div>
    `;
  }

  try {
    let url = `/api/feed?day_offset=${appState.dayOffset}`;
    if (appState.simulatedHour !== null) {
      url += `&simulated_hour=${appState.simulatedHour}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error("API Offline");
    const data = await response.json();
    appState.currentData = data;
    renderAll(data);
  } catch (err) {
    console.warn("Backend API não respondeu. Usando fallback offline do cliente.", err);
    useOfflineFallback();
  }
}

// Renderiza todos os widgets do Dashboard
function renderAll(data) {
  renderWeeklyBoard(data.week_columns);
  renderWeekSelector(data.week_overview, data.meta);
  renderMeta(data.meta);
  renderTopActivities(data.top_activities);
  renderRadarTimeline(data.hourly_timeline);
  renderMapLayers(data);
  renderRiskTable(appState.activeRiskCategory);
  renderIntercityRules(data.intercity_rules);
  if (window.lucide) {
    lucide.createIcons();
  }
}

// Renderiza o Painel Semanal de 7 Colunas (Segunda a Domingo)
function renderWeeklyBoard(weekColumns) {
  const container = document.getElementById("weekly-columns-container");
  if (!container || !weekColumns) return;

  container.innerHTML = weekColumns.map((col, colIdx) => {
    const isToday = col.is_today;
    const isSelected = col.is_selected;

    // Badge do Dia
    let dayThemeBorder = "border-pira-700/70";
    let dayHeaderBg = "bg-pira-800";
    let dayTag = `<span class="text-[9px] bg-pira-700 text-slate-300 px-1.5 py-0.5 rounded font-mono">${col.weekday_name}</span>`;

    if (colIdx === 5) { // Sábado
      dayThemeBorder = "border-pira-rose/60 shadow-[0_0_15px_rgba(255,51,102,0.15)]";
      dayHeaderBg = "bg-rose-950/40";
      dayTag = `<span class="text-[9px] bg-rose-900 text-rose-200 px-1.5 py-0.5 rounded font-mono font-bold">🔥 MEGA SHOWS</span>`;
    } else if (colIdx === 4) { // Sexta
      dayThemeBorder = "border-pira-emerald/60 shadow-[0_0_15px_rgba(0,245,155,0.15)]";
      dayHeaderBg = "bg-emerald-950/40";
      dayTag = `<span class="text-[9px] bg-emerald-900 text-emerald-200 px-1.5 py-0.5 rounded font-mono font-bold">💎 OURO NOITE</span>`;
    } else if (colIdx === 6) { // Domingo
      dayThemeBorder = "border-pira-amber/60";
      dayHeaderBg = "bg-amber-950/40";
      dayTag = `<span class="text-[9px] bg-amber-900 text-amber-200 px-1.5 py-0.5 rounded font-mono font-bold">🐟 TURISMO</span>`;
    }

    const eventsHtml = (col.events || []).map((evt, idx) => {
      const isTopEvent = idx === 0;
      let categoryBadge = "bg-pira-800 text-slate-300 border-pira-700";
      if (evt.category === 'CULTURA_TEATRO') categoryBadge = "bg-purple-950 text-purple-300 border-purple-800";
      else if (evt.category === 'SHOPPING_CINEMA') categoryBadge = "bg-blue-950 text-cyan-300 border-blue-800";
      else if (evt.category === 'MEGA_EVENTO') categoryBadge = "bg-rose-950 text-rose-300 border-rose-800";
      else if (evt.category === 'VIDA_NOTURNA') categoryBadge = "bg-emerald-950 text-emerald-300 border-emerald-800";
      else if (evt.category === 'GASTRONOMIA') categoryBadge = "bg-amber-950 text-amber-300 border-amber-800";

      return `
        <div class="p-2.5 rounded-lg bg-pira-800/90 border ${isTopEvent ? 'border-pira-emerald/40' : 'border-pira-700/50'} space-y-1.5 text-left">
          <div class="flex justify-between items-start gap-1">
            <span class="text-[8px] font-mono px-1 py-0.5 rounded border ${categoryBadge}">
              ${evt.category.replace('_', ' ')}
            </span>
            <span class="text-[10px] font-mono font-bold ${evt.calculated_score >= 85 ? 'text-pira-emerald' : (evt.calculated_score >= 70 ? 'text-pira-cyan' : 'text-pira-amber')}">
              ${Math.round(evt.calculated_score)} pts
            </span>
          </div>

          <strong class="text-[11px] font-bold text-slate-100 block leading-snug">${evt.name}</strong>
          
          <div class="flex justify-between items-center text-[9px] font-mono text-slate-400">
            <span class="truncate max-w-[130px]" title="${evt.venue}">📍 ${evt.venue}</span>
            <span class="text-slate-200">⏰ ${evt.peak_time}</span>
          </div>

          <!-- Fonte Oficial e Status -->
          <div class="flex items-center justify-between text-[8px] font-mono pt-1 border-t border-pira-700/40">
            <span class="text-pira-cyan truncate max-w-[120px]">
              🎟️ ${evt.source_name || 'Fonte Oficial Piracicaba'}
            </span>
            ${evt.source_url ? `<a href="${evt.source_url}" target="_blank" rel="noopener noreferrer" class="text-pira-emerald hover:underline font-bold">Verificar ↗</a>` : ''}
          </div>

          <p class="text-[9px] text-slate-400 line-clamp-2 leading-tight border-t border-pira-700/30 pt-1">
            ${evt.notes}
          </p>
        </div>
      `;
    }).join("");

    return `
      <div class="snap-center shrink-0 w-[240px] md:w-[260px] bg-pira-850 rounded-xl p-3 border ${dayThemeBorder} flex flex-col justify-between space-y-2.5">
        <!-- Cabeçalho da Coluna do Dia -->
        <div class="p-2 rounded-lg ${dayHeaderBg} border border-pira-700/60 flex justify-between items-center">
          <div>
            <strong class="text-xs font-bold text-white block">${col.weekday_full}</strong>
            <span class="text-[10px] font-mono text-slate-300">${col.formatted_date} ${isToday ? '• (HOJE)' : ''}</span>
          </div>
          ${dayTag}
        </div>

        <!-- Lista de Eventos / Teatros / Cinema / Polos -->
        <div class="space-y-2 max-h-[380px] overflow-y-auto pr-0.5 scrollbar-thin">
          ${eventsHtml}
        </div>

        <!-- Botão para focar neste dia -->
        <button onclick="selectDayOffset(${colIdx - new Date().getDay() + 1}); scrollToSection('focus-feed-status-section');" class="w-full py-1.5 bg-pira-800 hover:bg-pira-700 text-pira-cyan text-[10px] font-mono font-bold rounded-lg border border-pira-700 transition active:scale-95">
          🎯 Ver no Radar & Mapa
        </button>
      </div>
    `;
  }).join("");
}

// Renderiza a barra de seleção semanal (Seg a Dom)
function renderWeekSelector(weekOverview, meta) {
  const container = document.getElementById("week-day-selector");
  const labelEl = document.getElementById("current-day-label");
  if (!container) return;

  if (meta && labelEl) {
    labelEl.innerText = `${meta.eval_weekday} (${meta.eval_date})`;
  }

  if (!weekOverview || weekOverview.length === 0) {
    const defaultDays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    container.innerHTML = defaultDays.map((d, idx) => `
      <button onclick="selectDayOffset(${idx})" class="p-1.5 rounded-lg border ${idx === appState.dayOffset ? 'bg-pira-emerald text-black font-bold border-pira-emerald' : 'bg-pira-800 text-slate-300 border-pira-700'}">
        <span class="block font-bold">${d}</span>
      </button>
    `).join("");
    return;
  }

  container.innerHTML = weekOverview.map((item, idx) => {
    const isSelected = item.is_selected;
    const isMega = item.day_type === 'MEGA_EVENTO';
    const isShow = item.day_type === 'SHOW_VIDA_NOTURNA';

    let badgeDot = '';
    if (isMega) {
      badgeDot = '<span class="inline-block w-1.5 h-1.5 rounded-full bg-pira-rose animate-ping"></span>';
    } else if (isShow) {
      badgeDot = '<span class="inline-block w-1.5 h-1.5 rounded-full bg-pira-cyan"></span>';
    }

    return `
      <button onclick="selectDayOffset(${idx - new Date().getDay() + 1})" class="p-1.5 rounded-lg border flex flex-col items-center justify-between transition active:scale-95 ${isSelected ? 'bg-pira-emerald text-black font-black border-pira-emerald shadow-[0_0_12px_rgba(0,245,155,0.4)]' : 'bg-pira-800 text-slate-300 border-pira-700 hover:border-slate-500'}">
        <div class="flex items-center gap-0.5">
          <span class="text-[9px] font-bold uppercase">${item.weekday_name.substring(0, 3)}</span>
          ${badgeDot}
        </div>
        <span class="text-[11px] font-mono leading-tight my-0.5">${item.formatted_date}</span>
        <span class="text-[8px] font-mono px-1 rounded ${isSelected ? 'bg-black/20 text-black' : (item.top_score >= 85 ? 'text-pira-emerald font-bold' : 'text-slate-400')}">
          ${Math.round(item.top_score)} pts
        </span>
      </button>
    `;
  }).join("");
}

// Troca o dia selecionado
function selectDayOffset(offset) {
  // Garante offset válido
  appState.dayOffset = Math.max(0, Math.min(6, offset));
  fetchFeed(true);
}

// Meta informações e Badges de Atualização
function renderMeta(meta) {
  if (!meta) return;
  const lastScrapedEl = document.getElementById("last-update-time");
  const nextScrapedEl = document.getElementById("next-scrape-eta");
  const activeCountEl = document.getElementById("active-count-badge");
  const radarNowEl = document.getElementById("radar-now-badge");

  if (lastScrapedEl) {
    lastScrapedEl.innerText = meta.last_scraped_at ? meta.last_scraped_at.split(" ")[1].substring(0, 5) : meta.current_eval_time;
  }
  if (nextScrapedEl) {
    nextScrapedEl.innerText = meta.next_scrape_at ? `Próx: ${meta.next_scrape_at.split(" ")[1].substring(0, 5)}` : "Em 45m";
  }
  if (activeCountEl) {
    activeCountEl.innerText = `${meta.active_events_count || 6} Polos Mapeados`;
  }
  if (radarNowEl) {
    if (appState.simulatedHour !== null) {
      const hStr = String(appState.simulatedHour).padStart(2, '0') + ':00';
      radarNowEl.innerText = `SIMULANDO: ${hStr}`;
      radarNowEl.className = "text-[10px] text-pira-amber font-mono font-bold animate-pulse bg-amber-950/80 px-2 py-0.5 rounded border border-amber-700";
    } else {
      radarNowEl.innerText = `AGORA: ${meta.current_eval_time}`;
      radarNowEl.className = "text-[10px] text-pira-emerald font-mono font-bold animate-pulse bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-700";
    }
  }
}

// 1. TOP ATIVIDADES DO DIA (MELHOR PARA O PIOR)
function renderTopActivities(events) {
  const container = document.getElementById("ranked-cards-list");
  if (!container || !events) return;

  container.innerHTML = events.map((evt, idx) => {
    const isTop = idx === 0;
    const scoreColorClass = evt.calculated_score >= 85 ? "text-pira-emerald score-badge-gold" :
                           evt.calculated_score >= 70 ? "text-pira-cyan score-badge-blue" : "text-pira-amber score-badge-amber";

    const badgeBg = evt.calculated_score >= 85 ? "bg-emerald-950/80 text-pira-emerald border-emerald-700/60" :
                    evt.calculated_score >= 70 ? "bg-blue-950/80 text-pira-cyan border-blue-700/60" : "bg-amber-950/80 text-pira-amber border-amber-700/60";

    return `
      <div class="hud-card bg-pira-850 rounded-xl p-3.5 border ${isTop ? 'border-pira-emerald/60 shadow-[0_0_20px_rgba(0,245,155,0.12)]' : 'border-pira-700/70'} relative overflow-hidden">
        ${isTop ? '<div class="absolute top-0 right-0 bg-pira-emerald text-black text-[9px] font-black uppercase px-2 py-0.5 rounded-bl-lg font-mono">#1 OPORTUNIDADE DE OURO</div>' : ''}
        
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="flex-1">
            <div class="flex items-center gap-1.5 mb-1 flex-wrap">
              <span class="text-[9px] font-mono px-1.5 py-0.5 rounded ${badgeBg} border font-bold">
                ${evt.category.replace('_', ' ')}
              </span>
              <span class="text-[9px] font-mono text-slate-400 flex items-center gap-1">
                <i data-lucide="clock" class="w-2.5 h-2.5"></i> Pico: <strong class="text-slate-200">${evt.peak_window || evt.peak_time}</strong>
              </span>
            </div>
            <h3 class="text-sm font-bold text-slate-100 leading-snug">${evt.name}</h3>
            <p class="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
              <i data-lucide="map-pin" class="w-3 h-3 text-pira-cyan"></i> ${evt.venue}
            </p>
          </div>

          <!-- Score Circle Widget -->
          <div class="flex flex-col items-center justify-center p-2 rounded-xl bg-pira-800 border border-pira-700 min-w-[62px]">
            <span class="text-[9px] text-slate-400 font-mono uppercase">Score</span>
            <span class="text-xl font-black font-mono leading-none ${scoreColorClass.split(' ')[0]}">${evt.calculated_score}</span>
            <span class="text-[8px] text-slate-400 mt-0.5 font-mono">/ 100</span>
          </div>
        </div>

        <!-- Fonte Oficial & Status de Ingressos -->
        <div class="flex items-center justify-between text-[9px] font-mono bg-pira-900/80 px-2 py-1.5 rounded-lg border border-pira-700/60 mb-2">
          <div class="flex items-center gap-1.5 truncate">
            <span class="text-pira-cyan">🎟️ ${evt.source_name || 'Fonte Oficial Piracicaba'}</span>
            ${evt.ticket_status ? `<span class="bg-pira-800 text-slate-300 px-1 py-0.5 rounded text-[8px] border border-pira-700/50">${evt.ticket_status}</span>` : ''}
          </div>
          ${evt.source_url ? `<a href="${evt.source_url}" target="_blank" rel="noopener noreferrer" class="text-pira-emerald font-bold hover:underline shrink-0 ml-1">Verificar ↗</a>` : ''}
        </div>

        <!-- Tactical Metrics Grid -->
        <div class="grid grid-cols-3 gap-1.5 text-[10px] font-mono bg-pira-800/80 p-2 rounded-lg border border-pira-700/50 my-2">
          <div>
            <span class="text-slate-400 block text-[9px]">Público Est.</span>
            <strong class="text-slate-200">${evt.audience.toLocaleString('pt-BR')} pess.</strong>
          </div>
          <div>
            <span class="text-slate-400 block text-[9px]">Prob. Dinâmico</span>
            <strong class="text-pira-cyan font-bold">${Math.round(evt.dynamic_prob * 100)}%</strong>
          </div>
          <div>
            <span class="text-slate-400 block text-[9px]">Poder Aquisit.</span>
            <strong class="text-pira-emerald">${evt.purchasing_power}/100</strong>
          </div>
        </div>

        <!-- Strategy Note & Action -->
        <div class="flex justify-between items-center text-[10px] mt-2 pt-1 border-t border-pira-700/40">
          <p class="text-slate-400 text-[11px] leading-relaxed flex-1 mr-2">${evt.notes || "Posicione-se 15 minutos antes da dispersão oficial."}</p>
          <span class="text-[9px] font-mono font-bold px-2 py-1 rounded bg-pira-700 text-pira-emerald uppercase whitespace-nowrap border border-pira-emerald/30">
            ${evt.action_tag || 'POSICIONAR'}
          </span>
        </div>
      </div>
    `;
  }).join("");
}

// 2. RADAR DE FAIXAS HORÁRIAS
function renderRadarTimeline(timeline) {
  const container = document.getElementById("radar-timeline");
  if (!container || !timeline) return;

  container.innerHTML = timeline.map((item, idx) => {
    const isFirst = idx === 0;
    return `
      <div class="flex items-center justify-between p-2 rounded-lg ${isFirst ? 'bg-pira-800 border border-pira-cyan/50' : 'bg-pira-800/50 border border-pira-700/40'} text-xs font-mono">
        <div class="flex items-center space-x-2.5">
          <span class="font-bold ${isFirst ? 'text-pira-cyan' : 'text-slate-400'} text-xs w-11">${item.hour_slot}</span>
          <div>
            <strong class="text-slate-200 block text-[11px] leading-tight">${item.primary_hub}</strong>
            <span class="text-[9px] text-slate-400">${item.event_name.substring(0, 32)}...</span>
          </div>
        </div>
        <div class="text-right">
          <span class="text-xs font-bold text-pira-emerald block">${item.score} pts</span>
          <span class="text-[8px] bg-pira-700 text-slate-300 px-1 rounded uppercase">${item.action}</span>
        </div>
      </div>
    `;
  }).join("");
}

// 3. MAPA TÁTICO LEAFLET
function renderMapLayers(data) {
  if (!appState.map || !appState.markersLayer) return;

  appState.markersLayer.clearLayers();
  appState.polygonsLayer.clearLayers();

  let safeCount = 0;
  let riskCount = 0;

  // Função auxiliar para ícone temático de eventos/polos
  function getCategoryEmoji(cat, name = '') {
    if (cat.includes('SHOPPING') || name.includes('Shopping')) return '🛍️';
    if (cat.includes('UNIVERSIDADE') || name.includes('ESALQ') || name.includes('FOP')) return '🎓';
    if (cat.includes('GASTRONOMIA') || name.includes('Porto') || name.includes('Peixe')) return '🐟';
    if (cat.includes('TEATRO') || cat.includes('CULTURA') || name.includes('Engenho')) return '🎭';
    if (cat.includes('NOTURNA') || name.includes('Botelho') || name.includes('Bar')) return '🍺';
    if (cat.includes('INDUSTRIA') || name.includes('Hyundai') || name.includes('Unileste')) return '🏭';
    return '⭐';
  }

  // 1. Plotar Eventos Ativos & Pólos de Demanda
  if (appState.activeMapFilter === 'ALL' || appState.activeMapFilter === 'SAFE') {
    (data.top_activities || []).forEach(evt => {
      if (evt.lat && evt.lng) {
        safeCount++;
        const emoji = getCategoryEmoji(evt.category || '', evt.name);
        
        // Marcador HTML customizado e nítido
        const customIcon = L.divIcon({
          className: 'custom-tactical-pin-wrapper',
          html: `
            <div class="tactical-marker-pin marker-safe w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shadow-xl border-2 border-white ring-2 ring-emerald-400/50">
              ${emoji}
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -18]
        });

        const marker = L.marker([evt.lat, evt.lng], { icon: customIcon }).addTo(appState.markersLayer);

        // Tooltip com nome do local sempre legível no hover
        marker.bindTooltip(`<strong>${evt.venue || evt.name}</strong> • ${Math.round(evt.calculated_score || 80)} pts`, {
          direction: 'top',
          offset: [0, -18],
          className: 'tactical-tooltip'
        });

        // Popup completo com botão para abrir rota no GPS
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${evt.lat},${evt.lng}`;
        const wazeUrl = `https://waze.com/ul?ll=${evt.lat},${evt.lng}&navigate=yes`;

        marker.bindPopup(`
          <div class="text-xs space-y-2 p-1 min-w-[210px]">
            <div class="flex items-center justify-between border-b border-pira-700/60 pb-1.5">
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-pira-emerald font-bold border border-emerald-700">
                ${(evt.category || 'OPORTUNIDADE').replace('_', ' ')}
              </span>
              <span class="text-xs font-mono font-black text-pira-emerald">${Math.round(evt.calculated_score || 80)} pts</span>
            </div>

            <div>
              <strong class="text-white text-xs block leading-tight">${evt.name}</strong>
              <span class="text-[11px] text-pira-cyan block mt-0.5">📍 ${evt.venue}</span>
            </div>

            <div class="grid grid-cols-2 gap-1 text-[10px] font-mono bg-pira-900/90 p-1.5 rounded border border-pira-700/50">
              <div>
                <span class="text-slate-400 block text-[9px]">Pico:</span>
                <strong class="text-slate-200">${evt.peak_window || evt.peak_time || '22h'}</strong>
              </div>
              <div>
                <span class="text-slate-400 block text-[9px]">Dinâmico:</span>
                <strong class="text-pira-emerald">${Math.round((evt.dynamic_prob || 0.8) * 100)}%</strong>
              </div>
            </div>

            <!-- Botões de GPS -->
            <div class="flex gap-1.5 pt-1">
              <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="flex-1 py-1 px-2 bg-pira-700 hover:bg-pira-600 text-white rounded text-[10px] font-bold text-center border border-slate-600 transition">
                🗺️ Maps
              </a>
              <a href="${wazeUrl}" target="_blank" rel="noopener noreferrer" class="flex-1 py-1 px-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-bold text-center transition">
                🚗 Waze
              </a>
            </div>
          </div>
        `);
      }
    });
  }

  // 2. Plotar Zonas de Risco / Diurno / Noturno / Km Morto
  if (appState.activeMapFilter === 'ALL' || appState.activeMapFilter === 'RISK') {
    const allRiskZones = [
      ...(data.risk_zones || []),
      ...(data.deadhead_blackholes || [])
    ];

    allRiskZones.forEach(rz => {
      if (!rz.lat || !rz.lng) return;
      riskCount++;

      let color = '#FF3366'; // Vermelho default
      let markerClass = 'marker-risk';
      let iconSymbol = '⛔';

      if (rz.type === 'CUIDADO_DIURNO') {
        color = '#F59E0B';
        markerClass = 'marker-warning';
        iconSymbol = '☀️';
      } else if (rz.type === 'GARGALO_DIURNO') {
        color = '#00D8F6';
        markerClass = 'marker-bottleneck';
        iconSymbol = '🚦';
      } else if (rz.type === 'KM_MORTO') {
        color = '#FFB800';
        markerClass = 'marker-warning';
        iconSymbol = '⚠️';
      } else if (rz.type === 'BLOQUEIO_CRITICO') {
        color = '#9D4EDD';
        markerClass = 'marker-risk';
        iconSymbol = '🚫';
      }

      // Círculo de Perímetro
      L.circle([rz.lat, rz.lng], {
        radius: rz.type === 'GARGALO_DIURNO' ? 450 : 650,
        color: color,
        fillColor: color,
        fillOpacity: 0.25,
        weight: 2
      }).addTo(appState.polygonsLayer);

      // Pino Central com Ícone de Alerta
      const riskIcon = L.divIcon({
        className: 'custom-risk-pin-wrapper',
        html: `
          <div class="tactical-marker-pin ${markerClass} w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shadow-xl border-2 border-white ring-2 ring-rose-500/50">
            ${iconSymbol}
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -15]
      });

      const riskMarker = L.marker([rz.lat, rz.lng], { icon: riskIcon }).addTo(appState.markersLayer);

      riskMarker.bindTooltip(`<strong>${rz.name}</strong>`, {
        direction: 'top',
        offset: [0, -15],
        className: 'tactical-tooltip'
      });

      riskMarker.bindPopup(`
        <div class="text-xs space-y-2 p-1 min-w-[210px]">
          <div class="flex items-center justify-between border-b border-pira-700/60 pb-1">
            <span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold" style="background-color: ${color}33; color: ${color}; border: 1px solid ${color};">
              ${(rz.type || 'RISCO').replace('_', ' ')}
            </span>
          </div>
          <div>
            <strong class="text-white text-xs block">${rz.name}</strong>
            <p class="text-slate-300 text-[11px] leading-snug mt-1">${rz.night_warning}</p>
          </div>
        </div>
      `);
    });
  }

  // Atualiza badge de contagem de pontos no cabeçalho do mapa
  const countEl = document.getElementById("map-point-count");
  if (countEl) {
    countEl.innerText = `${safeCount} Oportunidades • ${riskCount} Alertas`;
  }
}

// Filtro visual do mapa
function filterMap(filterType, btnEl) {
  appState.activeMapFilter = filterType;
  document.querySelectorAll('.map-filter-btn').forEach(btn => {
    btn.className = "map-filter-btn px-2 py-0.5 rounded text-slate-300 font-mono hover:bg-pira-800";
  });
  if (btnEl) {
    if (filterType === 'SAFE') {
      btnEl.className = "map-filter-btn px-2 py-0.5 rounded bg-emerald-900 text-pira-emerald font-mono font-bold border border-emerald-700";
    } else if (filterType === 'RISK') {
      btnEl.className = "map-filter-btn px-2 py-0.5 rounded bg-rose-950 text-pira-rose font-mono font-bold border border-rose-700";
    } else {
      btnEl.className = "map-filter-btn px-2 py-0.5 rounded bg-pira-700 text-white font-mono font-bold";
    }
  }

  if (appState.currentData) {
    renderMapLayers(appState.currentData);
  }
}

// 4. MATRIZ DE SEGURANÇA & FILTROS DE ACEITE (DIURNO & NOTURNO)
function renderRiskTable(category = 'ALL', btnEl = null) {
  appState.activeRiskCategory = category;
  const container = document.getElementById("risk-list");
  if (!container || !appState.currentData) return;

  if (btnEl) {
    document.querySelectorAll('.risk-pill-btn').forEach(b => {
      b.classList.remove('bg-pira-700', 'text-white', 'active');
      b.classList.add('bg-pira-800');
    });
    btnEl.classList.remove('bg-pira-800');
    btnEl.classList.add('bg-pira-700', 'text-white', 'active');
  }

  let allRisk = [
    ...(appState.currentData.risk_zones || []),
    ...(appState.currentData.deadhead_blackholes || [])
  ];

  if (category !== 'ALL') {
    allRisk = allRisk.filter(item => item.type === category);
  }

  container.innerHTML = allRisk.map(item => {
    let tagBg = 'bg-rose-950/70 text-pira-rose border-rose-800/60';
    let iconName = 'alert-triangle';
    let iconColor = 'text-pira-rose';

    if (item.type === 'CUIDADO_DIURNO') {
      tagBg = 'bg-amber-950/80 text-amber-300 border-amber-800/60';
      iconName = 'sun';
      iconColor = 'text-amber-400';
    } else if (item.type === 'GARGALO_DIURNO') {
      tagBg = 'bg-blue-950/80 text-pira-cyan border-cyan-800/60';
      iconName = 'hourglass';
      iconColor = 'text-pira-cyan';
    } else if (item.type === 'KM_MORTO') {
      tagBg = 'bg-yellow-950/70 text-pira-amber border-yellow-800/60';
      iconName = 'arrow-down-left';
      iconColor = 'text-pira-amber';
    } else if (item.type === 'BLOQUEIO_CRITICO') {
      tagBg = 'bg-purple-950/70 text-pira-purple border-purple-800/60';
      iconName = 'slash';
      iconColor = 'text-pira-purple';
    }

    return `
      <div class="p-2.5 rounded-lg bg-pira-800/70 border border-pira-700/60 flex items-start gap-2.5 text-xs">
        <i data-lucide="${iconName}" class="w-4 h-4 ${iconColor} shrink-0 mt-0.5"></i>
        <div class="flex-1">
          <div class="flex items-center justify-between gap-2 mb-1">
            <strong class="text-slate-200 text-xs">${item.name}</strong>
            <span class="text-[9px] font-mono px-1.5 py-0.5 rounded border ${tagBg}">${item.type.replace('_', ' ')}</span>
          </div>
          <p class="text-slate-400 text-[11px] leading-snug">${item.night_warning}</p>
        </div>
      </div>
    `;
  }).join("");

  if (window.lucide) {
    lucide.createIcons();
  }
}

// 5. REGRA DE OURO INTERMUNICIPAL
function renderIntercityRules(rules) {
  const container = document.getElementById("intercity-list");
  if (!container || !rules) return;

  container.innerHTML = rules.map(rule => {
    const verdictColor = rule.verdict.includes('OURO') ? 'text-pira-emerald bg-emerald-950/80 border-emerald-800' :
                         rule.verdict.includes('EXCELENTE') ? 'text-pira-cyan bg-blue-950/80 border-blue-800' :
                         rule.verdict.includes('VIÁVEL') ? 'text-slate-200 bg-pira-800 border-pira-700' :
                         'text-pira-amber bg-amber-950/80 border-amber-800';

    return `
      <div class="p-3 rounded-xl bg-pira-800 border border-pira-700/70 space-y-1.5">
        <div class="flex justify-between items-start">
          <div>
            <strong class="text-slate-100 text-xs">${rule.destination}</strong>
            <div class="text-[10px] font-mono text-slate-400 flex gap-2 mt-0.5">
              <span>Distância: <strong>${rule.distance_km} km</strong></span>
              <span>Pedágios: <strong>R$ ${rule.tolls_brl.toFixed(2)}</strong></span>
            </div>
          </div>
          <span class="text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${verdictColor}">
            ${rule.verdict}
          </span>
        </div>
        <p class="text-[11px] text-slate-300 leading-tight pt-1 border-t border-pira-700/40">
          <span class="text-pira-amber font-mono font-bold">Diretriz:</span> ${rule.strategy}
        </p>
      </div>
    `;
  }).join("");
}

// 6. CALCULADORA DE VIABILIDADE DE CORRIDA & AVALIADOR TÁTICO
function setFuelType(type) {
  const priceInput = document.getElementById("cfg-fuel-price");
  const kmlInput = document.getElementById("cfg-fuel-kml");
  const maintInput = document.getElementById("cfg-maint-km");

  // Destacar botão ativo
  document.querySelectorAll('.fuel-type-btn').forEach(b => {
    b.classList.remove('bg-pira-700', 'text-pira-emerald', 'font-bold', 'border-pira-emerald/50');
    b.classList.add('bg-pira-800', 'text-slate-300', 'border-pira-700');
  });

  if (type === 'ETANOL') {
    if (priceInput) priceInput.value = "3.69";
    if (kmlInput) kmlInput.value = "8.5";
    if (maintInput) maintInput.value = "0.25";
    const btn = document.getElementById("btn-fuel-etanol");
    if (btn) btn.className = "fuel-type-btn p-1 rounded bg-pira-700 text-pira-emerald font-bold border border-pira-emerald/50";
  } else if (type === 'GASOLINA') {
    if (priceInput) priceInput.value = "5.79";
    if (kmlInput) kmlInput.value = "12.0";
    if (maintInput) maintInput.value = "0.25";
    const btn = document.getElementById("btn-fuel-gasolina");
    if (btn) btn.className = "fuel-type-btn p-1 rounded bg-pira-700 text-pira-emerald font-bold border border-pira-emerald/50";
  } else if (type === 'GNV') {
    if (priceInput) priceInput.value = "4.89";
    if (kmlInput) kmlInput.value = "14.0";
    if (maintInput) maintInput.value = "0.25";
    const btn = document.getElementById("btn-fuel-gnv");
    if (btn) btn.className = "fuel-type-btn p-1 rounded bg-pira-700 text-pira-emerald font-bold border border-pira-emerald/50";
  } else if (type === 'ELETRICO') {
    if (priceInput) priceInput.value = "0.95";
    if (kmlInput) kmlInput.value = "6.5";
    if (maintInput) maintInput.value = "0.15";
    const btn = document.getElementById("btn-fuel-eletrico");
    if (btn) btn.className = "fuel-type-btn p-1 rounded bg-pira-700 text-pira-emerald font-bold border border-pira-emerald/50";
  }

  calculateTripViability();
}

function setCalcPreset(val, km, min, dest) {
  const valInput = document.getElementById("calc-val");
  const kmInput = document.getElementById("calc-km");
  const minInput = document.getElementById("calc-min");
  const destSelect = document.getElementById("calc-dest");

  if (valInput) valInput.value = val;
  if (kmInput) kmInput.value = km;
  if (minInput) minInput.value = min;
  if (destSelect) destSelect.value = dest;

  calculateTripViability();
}

function calculateTripViability() {
  const valInput = document.getElementById("calc-val");
  const kmInput = document.getElementById("calc-km");
  const minInput = document.getElementById("calc-min");
  const destSelect = document.getElementById("calc-dest");

  const fuelPriceInput = document.getElementById("cfg-fuel-price");
  const fuelKmlInput = document.getElementById("cfg-fuel-kml");
  const maintInput = document.getElementById("cfg-maint-km");
  const costBadge = document.getElementById("calc-cost-per-km-badge");

  const val = parseFloat(valInput ? valInput.value : 0) || 0;
  const km = Math.max(0.1, parseFloat(kmInput ? kmInput.value : 1) || 1);
  const min = Math.max(1, parseFloat(minInput ? minInput.value : 1) || 1);
  const dest = destSelect ? destSelect.value : "Centro";

  // Cálculo do Custo Real Dinâmico por km:
  // Custo Combustível/km = Preço do Litro / Consumo km/L
  // Custo Total/km = Custo Combustível/km + Desgaste/Manutenção/km
  const fuelPrice = parseFloat(fuelPriceInput ? fuelPriceInput.value : 3.69) || 3.69;
  const fuelKml = Math.max(0.5, parseFloat(fuelKmlInput ? fuelKmlInput.value : 8.5) || 8.5);
  const maintPerKm = parseFloat(maintInput ? maintInput.value : 0.25) || 0.25;

  const fuelCostPerKm = fuelPrice / fuelKml;
  const totalCostPerKm = fuelCostPerKm + maintPerKm;

  if (costBadge) {
    costBadge.innerText = `Custo: R$ ${totalCostPerKm.toFixed(2)} / km (Comb: R$ ${fuelCostPerKm.toFixed(2)} + Desg: R$ ${maintPerKm.toFixed(2)})`;
  }

  const tripTotalCost = km * totalCostPerKm;
  const netEarnings = Math.max(0, val - tripTotalCost);
  
  // Métricas Principais
  const grossPerKm = val / km;
  const netPerKm = netEarnings / km;
  const netPerHour = (netEarnings / min) * 60;

  // Elementos do DOM
  const metricKmEl = document.getElementById("metric-rs-km");
  const metricHoraEl = document.getElementById("metric-rs-hora");
  const metricCustoEl = document.getElementById("metric-custo");
  const metricLucroEl = document.getElementById("metric-lucro");
  const verdictBox = document.getElementById("calc-verdict-box");
  const verdictTitle = document.getElementById("calc-verdict-title");
  const verdictDesc = document.getElementById("calc-verdict-desc");
  const badgeEl = document.getElementById("calc-badge");

  if (metricKmEl) metricKmEl.innerText = `R$ ${grossPerKm.toFixed(2)}`;
  if (metricHoraEl) metricHoraEl.innerText = `R$ ${netPerHour.toFixed(2)}/h`;
  if (metricCustoEl) metricCustoEl.innerText = `- R$ ${tripTotalCost.toFixed(2)}`;
  if (metricLucroEl) metricLucroEl.innerText = `R$ ${netEarnings.toFixed(2)}`;

  if (!badgeEl || !verdictBox) return;

  // Checagem de Zonas de Risco no Destino
  const isHighRiskDest = ['Pantanal', 'Mário Dedini', 'Morumbi', 'Ártemis'].includes(dest);
  const isDeadheadDest = ['Tupi', 'Anhumas'].includes(dest);
  const isIntercityGold = dest === 'Viracopos';

  if (isHighRiskDest) {
    verdictBox.className = "p-3 rounded-xl border border-rose-600/80 bg-rose-950/60 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs font-mono";
    if (verdictTitle) verdictTitle.innerText = "⛔ ALERTA DE SEGURANÇA:";
    if (verdictDesc) verdictDesc.innerText = `Destino (${dest}) com alto índice de ocorrências noturnas e vielas sem saída.`;
    badgeEl.className = "px-3 py-1.5 rounded-lg text-xs font-black bg-rose-700 text-white shadow-[0_0_15px_rgba(255,51,102,0.4)]";
    badgeEl.innerText = "RECUSAR (ZONA DE RISCO)";
    return;
  }

  if (isDeadheadDest && grossPerKm < 2.80) {
    verdictBox.className = "p-3 rounded-xl border border-amber-600/80 bg-amber-950/60 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs font-mono";
    if (verdictTitle) verdictTitle.innerText = "⚠️ ALERTA DE KM MORTO:";
    if (verdictDesc) verdictDesc.innerText = `Destino (${dest}) com 100% de volta vazia. Só compensa com dinâmico alto.`;
    badgeEl.className = "px-3 py-1.5 rounded-lg text-xs font-black bg-amber-600 text-black";
    badgeEl.innerText = "CUIDADO (RETORNO VAZIO)";
    return;
  }

  // Avaliação por Rendimento Líquido e Ganho/Hora
  if (grossPerKm >= 2.50 && netPerHour >= 55) {
    verdictBox.className = "p-3 rounded-xl border border-emerald-500/80 bg-emerald-950/50 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs font-mono";
    if (verdictTitle) verdictTitle.innerText = "🟢 VEREDITO: ACEITAR IMEDIATAMENTE";
    if (verdictDesc) verdictDesc.innerText = `Excelente taxa (R$ ${grossPerKm.toFixed(2)}/km) e projeção de R$ ${netPerHour.toFixed(0)}/h líquida.`;
    badgeEl.className = "px-3 py-1.5 rounded-lg text-xs font-black bg-emerald-500 text-black shadow-[0_0_15px_rgba(0,245,155,0.4)]";
    badgeEl.innerText = isIntercityGold ? "ACEITAR (OURO INTERMUNICIPAL)" : "ACEITAR (MUITO LUCRATIVA)";
  } else if (grossPerKm >= 1.90 && netPerHour >= 35) {
    verdictBox.className = "p-3 rounded-xl border border-blue-500/80 bg-blue-950/50 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs font-mono";
    if (verdictTitle) verdictTitle.innerText = "🔵 VEREDITO: VIÁVEL (DENTRO DA MÉDIA)";
    if (verdictDesc) verdictDesc.innerText = `Margem padrão (R$ ${grossPerKm.toFixed(2)}/km). Boa se você estiver indo na direção certa.`;
    badgeEl.className = "px-3 py-1.5 rounded-lg text-xs font-black bg-pira-cyan text-black";
    badgeEl.innerText = "VIÁVEL (REGULAR)";
  } else {
    verdictBox.className = "p-3 rounded-xl border border-rose-800/80 bg-rose-950/40 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs font-mono";
    if (verdictTitle) verdictTitle.innerText = "🔴 VEREDITO: RECUSAR CORRIDA";
    if (verdictDesc) verdictDesc.innerText = `Rendimento baixo (R$ ${grossPerKm.toFixed(2)}/km). O custo operacional (R$ ${totalCostPerKm.toFixed(2)}/km) e tempo consomem o lucro.`;
    badgeEl.className = "px-3 py-1.5 rounded-lg text-xs font-black bg-rose-900 text-rose-200 border border-rose-700";
    badgeEl.innerText = "RECUSAR (PREJUÍZO)";
  }
}

// Time Slider para Simulação 24 Horas
function onTimeSliderChange(val) {
  const hourNum = parseInt(val);
  appState.simulatedHour = hourNum;
  const hourStr = String(hourNum).padStart(2, '0');

  let periodName = "Madrugada";
  if (hourNum >= 6 && hourNum < 12) periodName = "Manhã";
  else if (hourNum >= 12 && hourNum < 15) periodName = "Almoço";
  else if (hourNum >= 15 && hourNum < 18) periodName = "Tarde";
  else if (hourNum >= 18 && hourNum < 23) periodName = "Pico Noite";

  const displayEl = document.getElementById("slider-hour-display");
  if (displayEl) {
    displayEl.innerText = `Simulando: ${hourStr}:00 (${periodName})`;
  }

  fetchFeed(false);
}

// Atalho rápido de Turno
function setTimeSliderPreset(hour) {
  const sliderEl = document.getElementById("time-slider");
  if (sliderEl) {
    sliderEl.value = hour;
  }
  onTimeSliderChange(hour);
}

// Resetar para Horário Real
function resetTimeSlider() {
  appState.simulatedHour = null;
  const realHour = new Date().getHours();
  const sliderEl = document.getElementById("time-slider");
  if (sliderEl) {
    sliderEl.value = realHour;
  }
  const displayEl = document.getElementById("slider-hour-display");
  if (displayEl) {
    displayEl.innerText = "Horário Real";
  }
  fetchFeed(false);
}

// Forçar Atualização
function forceRefresh() {
  const btn = document.getElementById("btn-refresh");
  if (btn) btn.classList.add("animate-spin");
  fetchFeed().finally(() => {
    if (btn) setTimeout(() => btn.classList.remove("animate-spin"), 600);
  });
}

// Scroll suave para seções
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Fallback de Dados Offline (Garante visualização mesmo sem FastAPI rodando)
function useOfflineFallback() {
  const today = new Date();
  const weekDays = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
  const currentDayIdx = (today.getDay() + 6) % 7; // 0=Seg, 6=Dom

  const week_overview = weekDays.map((name, idx) => {
    const d = new Date(today);
    d.setDate(today.getDate() - currentDayIdx + idx);
    const isSat = idx === 5;
    const isFri = idx === 4;
    const isSun = idx === 6;

    return {
      weekday_index: idx,
      weekday_name: name,
      formatted_date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      is_today: idx === currentDayIdx,
      is_selected: idx === (currentDayIdx + appState.dayOffset) % 7,
      events_count: isSat ? 9 : (isFri ? 8 : (isSun ? 6 : 5)),
      top_opportunity: isSat ? "Festival Engenho Central" : (isFri ? "Bares Carlos Botelho / Losso Netto" : (isSun ? "Turismo Gastronômico Rua do Porto" : "Saída ESALQ & Turno Unileste")),
      top_score: isSat ? 95 : (isFri ? 90 : (isSun ? 86 : 78)),
      peak_window: isSat ? "23:30 - 01:30" : (isSun ? "13:00 - 17:00" : "22:15 - 22:45"),
      day_type: isSat ? "MEGA_EVENTO" : (isFri || idx === 3 ? "SHOW_VIDA_NOTURNA" : (isSun ? "TURISMO" : "ROTINA_INDUSTRIAL_AULAS"))
    };
  });

  const sampleWeeklySchedule = [
    // Segunda
    [
      { name: "Segunda do Cinema - Cine Araújo", category: "SHOPPING_CINEMA", venue: "Shopping Piracicaba", peak_time: "21:45", calculated_score: 82, notes: "Lançamentos e salas multiplex." },
      { name: "Saída Aulas Noturnas USP / ESALQ", category: "UNIVERSIDADE", venue: "Campus ESALQ", peak_time: "22:15", calculated_score: 85, notes: "Centenas de pedidos nos portões." },
      { name: "Troca 3º Turno Unileste", category: "INDUSTRIA", venue: "Distrito Unileste", peak_time: "22:30", calculated_score: 75, notes: "Trabalhadores voltando para bairros." },
      { name: "Turno Noturno Hyundai", category: "INDUSTRIA", venue: "Pólo Hyundai SP-127", peak_time: "22:45", calculated_score: 80, notes: "Corridas médias e longas." }
    ],
    // Terça
    [
      { name: "Saída Clínicas Noturnas FOP-UNICAMP", category: "UNIVERSIDADE", venue: "FOP Areão", peak_time: "21:45", calculated_score: 80, notes: "Alunos e pacientes de pós-graduação." },
      { name: "Cinema & Debates no Galpão", category: "CULTURA_SHOW", venue: "Sesc Piracicaba", peak_time: "21:30", calculated_score: 76, notes: "Peças de teatro e mostras." },
      { name: "Dispersão Aulas ESALQ", category: "UNIVERSIDADE", venue: "Campus ESALQ", peak_time: "22:15", calculated_score: 84, notes: "Fluxo forte na Centenário." },
      { name: "Sessões Cine Araújo Shopping", category: "SHOPPING_CINEMA", venue: "Shopping Piracicaba", peak_time: "22:15", calculated_score: 80, notes: "Praça de alimentação e cinema." }
    ],
    // Quarta
    [
      { name: "Futebol & Chopp nos Pubs", category: "VIDA_NOTURNA", venue: "Av. Carlos Botelho", peak_time: "23:30", calculated_score: 90, notes: "Fim dos jogos nos bares." },
      { name: "Quarta do Cinema / Pré-Estreias", category: "SHOPPING_CINEMA", venue: "Shopping Piracicaba", peak_time: "22:15", calculated_score: 85, notes: "Salas VIP e lançamentos." },
      { name: "Jantar Tradicional na Beira-Rio", category: "GASTRONOMIA", venue: "Rua do Porto", peak_time: "21:30", calculated_score: 78, notes: "Mesas cheias nos restaurantes." },
      { name: "Troca de Turno Unileste", category: "INDUSTRIA", venue: "Unileste", peak_time: "22:30", calculated_score: 75, notes: "Volume garantido." }
    ],
    // Quinta
    [
      { name: "Quinta Universitária & Choppada", category: "VIDA_NOTURNA", venue: "Carlos Botelho / São Dimas", peak_time: "23:45", calculated_score: 94, notes: "Dinâmico alto das 23h às 02h." },
      { name: "Estreia Comédia / Stand-up", category: "CULTURA_TEATRO", venue: "Teatro Dr. Losso Netto", peak_time: "22:30", calculated_score: 88, notes: "Público qualificado / Comfort." },
      { name: "Saída Aulas Noturnas ESALQ", category: "UNIVERSIDADE", venue: "Portões ESALQ", peak_time: "22:15", calculated_score: 86, notes: "Muitas viagens para rodoviária." },
      { name: "Happy Hour Executivo Agtechs", category: "CORPORATIVO", venue: "Parque Tecnológico", peak_time: "18:30", calculated_score: 82, notes: "Executivos para hotéis e VCP." }
    ],
    // Sexta
    [
      { name: "Sexta Prime Bares & Boates", category: "VIDA_NOTURNA", venue: "Av. Carlos Botelho", peak_time: "00:00", calculated_score: 98, notes: "Faturamento máximo a noite toda." },
      { name: "Grande Espetáculo Nacional", category: "CULTURA_TEATRO", venue: "Teatro Dr. Losso Netto", peak_time: "22:45", calculated_score: 92, notes: "Alta taxa de Uber Black / gorjetas." },
      { name: "Show Musical ao Vivo Galpão", category: "CULTURA_SHOW", venue: "Sesc Piracicaba", peak_time: "22:00", calculated_score: 85, notes: "Ponto na Ipiranga ou Alferes." },
      { name: "Lançamentos e Pré-Estreias", category: "SHOPPING_CINEMA", venue: "Shopping Piracicaba", peak_time: "23:00", calculated_score: 88, notes: "Sessões da meia-noite lotadas." },
      { name: "Saída Viagens ESALQ (Fim de Semana)", category: "UNIVERSIDADE", venue: "Campus ESALQ", peak_time: "18:00", calculated_score: 90, notes: "Corridas para Campinas, VCP e Americana." }
    ],
    // Sábado
    [
      { name: "Festival Noturno / Grandes Shows", category: "MEGA_EVENTO", venue: "Parque Engenho Central", peak_time: "23:45", calculated_score: 99, notes: "Dinâmico 2.5x+. Posicionar Vila Rezende." },
      { name: "Almoço Turístico Peixe no Tambor", category: "GASTRONOMIA", venue: "Rua do Porto", peak_time: "14:00", calculated_score: 88, notes: "Famílias e turistas o dia todo." },
      { name: "Circuito de Sábado Bares & Baladas", category: "VIDA_NOTURNA", venue: "Av. Carlos Botelho", peak_time: "00:30", calculated_score: 96, notes: "Alta liquidez até 03h30." },
      { name: "Sessão Nobre de Teatro", category: "CULTURA_TEATRO", venue: "Teatro Dr. Losso Netto", peak_time: "22:30", calculated_score: 88, notes: "Saída sincronizada na Regente Feijó." },
      { name: "Formaturas e Casamentos", category: "MEGA_EVENTO", venue: "Clube Atlético / Engenho Eventos", peak_time: "02:00", calculated_score: 92, notes: "Corridas longas de madrugada." }
    ],
    // Domingo
    [
      { name: "Turismo e Gastronomia de Domingo", category: "GASTRONOMIA", venue: "Rua do Porto / Beira-Rio", peak_time: "14:30", calculated_score: 92, notes: "Maior polo do domingo (12h-17h30)." },
      { name: "Pico de Domingo Shopping Piracicaba", category: "SHOPPING_CINEMA", venue: "Shopping Piracicaba", peak_time: "20:00", calculated_score: 88, notes: "Cinemas e praça lotados." },
      { name: "Espetáculo Infantil & Comédia", category: "CULTURA_TEATRO", venue: "Teatro Dr. Losso Netto", peak_time: "19:00", calculated_score: 82, notes: "Famílias e casais no Centro." },
      { name: "Teatro & Dança no Galpão", category: "CULTURA_SHOW", venue: "Sesc Piracicaba", peak_time: "18:30", calculated_score: 78, notes: "Saída no início da noite." }
    ]
  ];

  const week_columns = weekDays.map((name, idx) => {
    const d = new Date(today);
    d.setDate(today.getDate() - currentDayIdx + idx);
    return {
      weekday_index: idx,
      weekday_name: name.substring(0, 3),
      weekday_full: name + "-feira",
      formatted_date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      is_today: idx === currentDayIdx,
      is_selected: idx === (currentDayIdx + appState.dayOffset) % 7,
      events: sampleWeeklySchedule[idx] || []
    };
  });

  const fallbackData = {
    meta: {
      city: "Piracicaba - SP",
      current_eval_time: "22:00",
      eval_date: `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`,
      eval_weekday: weekDays[currentDayIdx],
      last_scraped_at: "2026-09-22 21:55:00",
      next_scrape_at: "2026-09-22 22:55:00",
      active_events_count: 7
    },
    week_overview: week_overview,
    week_columns: week_columns,
    top_activities: [
      {
        id: "engenho_central",
        name: "Dispersão Mega Evento (Parque do Engenho Central)",
        category: "MEGA_EVENTO",
        venue: "Engenho Central / Av. Maurice Allain",
        peak_window: "23:15 - 00:30",
        audience: 9200,
        purchasing_power: 85,
        dynamic_prob: 0.98,
        calculated_score: 94.2,
        action_tag: "POSICIONAR NA VILA REZENDE",
        notes: "Alto volume de dinâmico 2.0x+. Evitar entrar na Maurice Allain para não travar no congestionamento da Ponte do Mirante."
      },
      {
        id: "shopping_piracicaba",
        name: "Fim de Sessão Multiplex Cine Araújo (Shopping Piracicaba)",
        category: "SHOPPING_CINEMA",
        venue: "Shopping Piracicaba",
        peak_window: "22:15 - 22:45",
        audience: 1800,
        purchasing_power: 80,
        dynamic_prob: 0.88,
        calculated_score: 83.5,
        action_tag: "PORTARIA A / BARES",
        notes: "Saída contínua de famílias e jovens. Corridas para Santa Teresinha, Vila Rezende e Centro."
      },
      {
        id: "carlos_botelho",
        name: "Circuito Gastronômico & Pubs (Av. Carlos Botelho)",
        category: "VIDA_NOTURNA",
        venue: "Av. Carlos Botelho / São Dimas",
        peak_window: "20:00 - 01:30",
        audience: 3400,
        purchasing_power: 88,
        dynamic_prob: 0.92,
        calculated_score: 79.8,
        action_tag: "GIRO CONTÍNUO SÃO DIMAS",
        notes: "Alta liquidez de passageiros. Excelente para faturar corridas curtas de categoria Comfort e Black."
      },
      {
        id: "esalq",
        name: "Saída das Aulas Noturnas (Campus ESALQ / USP)",
        category: "UNIVERSIDADE",
        venue: "ESALQ - Portões Centrais",
        peak_window: "22:15 - 22:45",
        audience: 2600,
        purchasing_power: 75,
        dynamic_prob: 0.85,
        calculated_score: 76.4,
        action_tag: "PORTÃO FERREIRA",
        notes: "Volume alto e simultâneo de pedidos para repúblicas e apartamentos no Agronomia e Centro."
      },
      {
        id: "losso_netto",
        name: "Espetáculo no Teatro Dr. Losso Netto",
        category: "CULTURA_TEATRO",
        venue: "Teatro Municipal Dr. Losso Netto",
        peak_window: "22:30 - 23:00",
        audience: 680,
        purchasing_power: 94,
        dynamic_prob: 0.80,
        calculated_score: 73.1,
        action_tag: "RUA REGENTE FEIJÓ",
        notes: "Público qualificado com alta taxa de gorjeta e preferência por carros novos."
      },
      {
        id: "unileste",
        name: "Troca de Turno Noturna (Distrito Industrial Unileste)",
        category: "INDUSTRIA",
        venue: "Unileste (Dedini/Caterpillar/Arcelor)",
        peak_window: "22:30 - 23:00",
        audience: 4500,
        purchasing_power: 65,
        dynamic_prob: 0.82,
        calculated_score: 68.9,
        action_tag: "AV. INDEPENDÊNCIA / UNILESTE",
        notes: "Muitas viagens para periferias. Recomenda-se conferir o destino antes de aceitar à noite."
      }
    ],
    hourly_timeline: [
      { hour_slot: "22:00", primary_hub: "Shopping Piracicaba", event_name: "Saída Cine Araújo", score: 83.5, action: "POSICIONAR" },
      { hour_slot: "22:30", primary_hub: "Campus ESALQ / USP", event_name: "Saída Alunos Noturno", score: 76.4, action: "RADAR PRÓXIMO" },
      { hour_slot: "23:00", primary_hub: "Engenho Central", event_name: "Mega Show / Dispersão", score: 94.2, action: "POSICIONAR AGORA" },
      { hour_slot: "00:00", primary_hub: "Av. Carlos Botelho", event_name: "Pubs & Baladas", score: 81.0, action: "GIRO CONTÍNUO" },
      { hour_slot: "01:00", primary_hub: "Av. Saldanha Marinho", event_name: "Fechamento Bares", score: 72.5, action: "MONITORAR" }
    ],
    risk_zones: [
      {
        name: "Beco do Pantanal / Fundo Pauliceia",
        type: "PERIGO_NOTURNO",
        night_warning: "Evitar após as 21h. Ruas estreitas sem saída e risco de abordagem."
      },
      {
        name: "Jardim Brasília / Extremo Mário Dedini",
        type: "PERIGO_NOTURNO",
        night_warning: "Risco em semáforos e valas após as 22h. Não aguardar com pisca alerta ligado."
      },
      {
        name: "Ligação Rural Ártemis / Tanquinho",
        type: "BLOQUEIO_CRITICO",
        night_warning: "Sem iluminação, sinal 4G intermitente e zero retorno de passageiros."
      },
      {
        name: "Distrito de Anhumas",
        type: "KM_MORTO",
        night_warning: "25km de km morto no retorno após as 20h. Só aceitar com taxa negociada."
      }
    ],
    deadhead_blackholes: [
      {
        name: "Distrito de Tupi / Ceasa",
        type: "KM_MORTO",
        night_warning: "15km de retorno sem passageiro após as 19h."
      },
      {
        name: "Alphaville Piracicaba (SP-127)",
        type: "KM_MORTO",
        night_warning: "Excelente tarifa de ida, mas retorno sempre vazio. Exigir dinâmico > 1.4x."
      }
    ],
    intercity_rules: [
      {
        destination: "Aeroporto de Viracopos (VCP) / Campinas",
        distance_km: 78,
        tolls_brl: 32.8,
        verdict: "OURO (ALTA DEMANDA)",
        strategy: "Mínimo R$ 160 líquido. Retorno garantido posicionando no bolsão do VCP ou Campinas Centro."
      },
      {
        destination: "Limeira Centro / Shopping Nações",
        distance_km: 34,
        tolls_brl: 14.5,
        verdict: "VIÁVEL",
        strategy: "Mínimo R$ 65 líquido. Ficar na Rodoviária ou Shopping Nações para pescar retorno."
      },
      {
        destination: "Americana / Santa Bárbara d'Oeste",
        distance_km: 38,
        tolls_brl: 0.0,
        verdict: "EXCELENTE (SEM PEDÁGIO)",
        strategy: "SP-304 pista dupla sem pedágio. Boa liquidez de volta pela Av. Santa Bárbara."
      },
      {
        destination: "Rio Claro Centro",
        distance_km: 39,
        tolls_brl: 12.0,
        verdict: "MODERADO",
        strategy: "Evitar corridas após 21h em dias úteis por falta de passageiro de retorno."
      }
    ]
  };

  appState.currentData = fallbackData;
  renderAll(fallbackData);
}
