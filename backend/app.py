"""
Servidor Full-Stack FastAPI com Agendador APScheduler e APIs Táticas para Motoristas (Piracicaba-SP)
===================================================================================================
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
except ImportError:
    AsyncIOScheduler = None

from backend.scrapers import PiracicabaEventPipeline
from backend.scoring_engine import OpportunityScoringEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("TacticalDashboardAPI")

app = FastAPI(
    title="Piracicaba Tactical Driver Hub API",
    description="Motor de Inteligência e Scoring Preditivo em Tempo Real para Motoristas de App em Piracicaba-SP",
    version="2.4.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Estado Global em Memória (Cache Ativo)
pipeline = PiracicabaEventPipeline()
scoring_engine = OpportunityScoringEngine()

state = {
    "last_scraped_at": None,
    "next_scrape_at": None,
    "raw_events": [],
    "ranked_events": [],
    "geodata": pipeline.base_data
}

async def run_pipeline_job():
    """Tarefa periódica do APScheduler ou disparo manual."""
    logger.info("Executando ciclo de atualização do pipeline de Piracicaba...")
    try:
        events = await pipeline.consolidate_all_events()
        now = datetime.now()
        ranked = scoring_engine.rank_events(events, current_time=now)
        state["raw_events"] = events
        state["ranked_events"] = ranked
        state["last_scraped_at"] = now.strftime("%Y-%m-%d %H:%M:%S")
        state["next_scrape_at"] = (now + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        logger.info(f"Pipeline concluído com sucesso. {len(ranked)} eventos ranqueados.")
    except Exception as e:
        logger.error(f"Falha ao executar pipeline: {e}")

@app.on_event("startup")
async def on_startup():
    await run_pipeline_job()
    if AsyncIOScheduler:
        scheduler = AsyncIOScheduler()
        scheduler.add_job(run_pipeline_job, "interval", hours=1)
        scheduler.start()
        logger.info("APScheduler iniciado: Atualização agendada hora a hora.")
    else:
        logger.warning("APScheduler não instalado. Atualizações automáticas rodarão sob demanda.")

@app.get("/api/health")
async def health():
    return {
        "status": "ONLINE",
        "city": "Piracicaba - SP",
        "timestamp": datetime.now().isoformat(),
        "last_update": state["last_scraped_at"]
    }

@app.get("/api/feed")
async def get_tactical_feed(
    simulated_hour: Optional[int] = Query(None, ge=0, le=23),
    day_offset: Optional[int] = Query(0, ge=0, le=6, description="0=Hoje, 1=Amanhã, etc. até o fim da semana")
):
    """
    Retorna o payload completo do dashboard para o dia selecionado da semana.
    """
    target_dt = datetime.now() + timedelta(days=day_offset)
    if simulated_hour is not None:
        target_dt = target_dt.replace(hour=simulated_hour, minute=0, second=0)

    # Coleta os eventos para o dia específico
    events_for_day = await pipeline.consolidate_all_events(target_date=target_dt.date())

    # Re-avalia o ranking com a hora e data desejada
    current_ranking = scoring_engine.rank_events(events_for_day, current_time=target_dt)

    # Recomendações de posicionamento imediato (Top 3)
    top_targets = current_ranking[:3] if current_ranking else []

    # Timeline horária das próximas 12 horas ou do dia
    timeline = []
    for h_offset in range(0, 12, 2):
        step_time = target_dt + timedelta(hours=h_offset)
        if current_ranking:
            ranked_step = scoring_engine.rank_events(events_for_day, current_time=step_time)
            best_evt = ranked_step[0]
            timeline.append({
                "hour_slot": step_time.strftime("%H:00"),
                "primary_hub": best_evt["venue"],
                "event_name": best_evt["name"],
                "score": best_evt["calculated_score"],
                "category": best_evt["category"],
                "action": best_evt["action_tag"]
            })

    # Resumo e Colunas detalhadas da semana completa (Segunda a Domingo)
    week_overview = []
    week_columns = []
    today = datetime.now()
    # Começa na segunda-feira atual
    start_of_week = today - timedelta(days=today.weekday())
    weekday_labels = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
    weekday_short = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
    
    for i in range(7):
        day_date = (start_of_week + timedelta(days=i)).date()
        day_events = await pipeline.consolidate_all_events(target_date=day_date)
        eval_time = datetime.combine(day_date, datetime.min.time()).replace(hour=22, minute=0)
        ranked_day = scoring_engine.rank_events(day_events, current_time=eval_time)
        top_event = ranked_day[0] if ranked_day else None

        week_overview.append({
            "weekday_index": i,
            "weekday_name": weekday_short[i],
            "weekday_full": weekday_labels[i],
            "formatted_date": day_date.strftime("%d/%m"),
            "is_today": day_date == today.date(),
            "is_selected": (today + timedelta(days=day_offset)).date() == day_date,
            "events_count": len(day_events),
            "top_opportunity": top_event["name"] if top_event else "Rotina Normal",
            "top_score": top_event["calculated_score"] if top_event else 50.0,
            "peak_window": top_event.get("peak_window", "22h") if top_event else "22h",
            "day_type": "MEGA_EVENTO" if i == 5 else ("SHOW_VIDA_NOTURNA" if i in [3, 4] else ("TURISMO" if i == 6 else "ROTINA_INDUSTRIAL_AULAS"))
        })

        week_columns.append({
            "weekday_index": i,
            "weekday_name": weekday_short[i],
            "weekday_full": weekday_labels[i],
            "formatted_date": day_date.strftime("%d/%m"),
            "is_today": day_date == today.date(),
            "is_selected": (today + timedelta(days=day_offset)).date() == day_date,
            "events": ranked_day
        })

    weekday_names_pt = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
    geodata = pipeline._load_base_data()

    return {
        "meta": {
            "city": "Piracicaba - SP",
            "current_eval_time": target_dt.strftime("%H:%M"),
            "eval_date": target_dt.strftime("%d/%m/%Y"),
            "eval_weekday": weekday_names_pt[target_dt.weekday()],
            "day_offset": day_offset,
            "last_scraped_at": state["last_scraped_at"],
            "next_scrape_at": state["next_scrape_at"],
            "active_events_count": len(current_ranking)
        },
        "top_activities": current_ranking,
        "immediate_recommendations": top_targets,
        "hourly_timeline": timeline,
        "week_overview": week_overview,
        "week_columns": week_columns,
        "risk_zones": geodata.get("geofences", {}).get("risk_zones", []),
        "deadhead_blackholes": geodata.get("geofences", {}).get("deadhead_blackholes", []),
        "safe_zones": geodata.get("geofences", {}).get("safe_zones", []),
        "intercity_rules": geodata.get("intercity_rules", [])
    }

@app.post("/api/scrape/trigger")
async def trigger_scrape(background_tasks: BackgroundTasks):
    """Disparo sob demanda via Webhook."""
    background_tasks.add_task(run_pipeline_job)
    return {"message": "Pipeline de scraping disparado em background.", "triggered_at": datetime.now().isoformat()}

frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

# Rotas exclusivas para o HUD Veicular Mobile
@app.get("/mobile")
@app.get("/hud")
async def get_mobile_hud():
    mobile_file = os.path.join(frontend_dir, "mobile.html")
    if os.path.exists(mobile_file):
        return FileResponse(mobile_file)
    return FileResponse(os.path.join(frontend_dir, "index.html"))

# Serve frontend static assets (HTML, CSS, JS, etc.)
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
