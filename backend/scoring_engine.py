"""
Motor de Score Preditivo e Ranking de Oportunidades para Motoristas de Aplicativo (Piracicaba-SP)
================================================================================================
Formulação Matemática:
---------------------
Score_Final = [ (w_D * D_norm + w_P * P_norm + w_S * S_norm + w_T * T_norm) ]
              * (1 - lambda_bottleneck) 
              * (1 - mu_deadhead) 
              * Phi_time_proximity

Pesos Padrão:
w_D (Densidade/Volume de Público)  = 0.35
w_P (Poder Aquisitivo)             = 0.20
w_S (Probabilidade Dinâmico/Surge) = 0.30
w_T (Potencial de Gorjeta/Comfort) = 0.15
"""

import math
from datetime import datetime, time
from typing import Dict, Any, List

class OpportunityScoringEngine:
    def __init__(self,
                 w_density: float = 0.35,
                 w_power: float = 0.20,
                 w_surge: float = 0.30,
                 w_tips: float = 0.15):
        self.w_density = w_density
        self.w_power = w_power
        self.w_surge = w_surge
        self.w_tips = w_tips

    @staticmethod
    def calculate_time_proximity_factor(event_peak_str: str, current_time: datetime = None) -> float:
        """
        Calcula o fator de proximidade temporal Phi(t) para qualquer horário das 24 horas.
        Se o horário simulado estiver DENTRO da janela do evento (ex: 12:00 - 16:00), dá boost máximo (1.25x).
        Se estiver antes ou depois, decai suavemente conforme a distância.
        """
        if not current_time:
            current_time = datetime.now()

        if not event_peak_str:
            return 1.0

        try:
            # Detecta se é intervalo (ex: "12:00 - 16:00", "20:00 - 03:00")
            parts = [p.strip() for p in event_peak_str.replace("h", ":").split("-")]
            
            def parse_hm(s: str) -> time:
                clean = s.split()[0].strip()
                if ":" not in clean:
                    clean += ":00"
                h, m = map(int, clean.split(":")[:2])
                return time(h % 24, m % 60)

            cur_t = current_time.time()
            cur_minutes = cur_t.hour * 60 + cur_t.minute

            if len(parts) >= 2:
                t_start = parse_hm(parts[0])
                t_end = parse_hm(parts[1])
                start_min = t_start.hour * 60 + t_start.minute
                end_min = t_end.hour * 60 + t_end.minute

                # Janela normal ou que atravessa a meia-noite
                is_inside = False
                if start_min <= end_min:
                    is_inside = (start_min - 20) <= cur_minutes <= (end_min + 20)
                else: # Atravessa meia noite (ex: 21:00 às 03:00)
                    is_inside = (cur_minutes >= start_min - 20) or (cur_minutes <= end_min + 20)

                if is_inside:
                    return 1.25 # Boost Ouro: Dentro da janela de alta demanda

                # Distância mínima até a borda mais próxima
                diff_to_start = abs(cur_minutes - start_min)
                if diff_to_start > 720: diff_to_start = 1440 - diff_to_start
                diff_to_end = abs(cur_minutes - end_min)
                if diff_to_end > 720: diff_to_end = 1440 - diff_to_end
                min_diff = min(diff_to_start, diff_to_end)

                if min_diff <= 45:
                    return 1.15
                elif min_diff <= 90:
                    return 0.95
                elif min_diff <= 180:
                    return 0.75
                else:
                    return max(0.40, 1.0 - (min_diff / 480.0))

            else:
                t_single = parse_hm(parts[0])
                single_min = t_single.hour * 60 + t_single.minute
                diff = abs(cur_minutes - single_min)
                if diff > 720: diff = 1440 - diff

                if diff <= 30:
                    return 1.25
                elif diff <= 60:
                    return 1.10
                elif diff <= 120:
                    return 0.85
                else:
                    return max(0.40, 1.0 - (diff / 480.0))

        except Exception as e:
            return 1.0

    def evaluate_opportunity(self, event: Dict[str, Any], current_time: datetime = None) -> Dict[str, Any]:
        """
        Calcula o score de 0 a 100 de um evento/polo de demanda.
        """
        if not current_time:
            current_time = datetime.now()

        # 1. Densidade Normalizada (0 a 100)
        raw_audience = event.get("audience", 500)
        # Log-linear scaling: 50 pessoas = 20, 500 = 60, 3000 = 90, 10000+ = 100
        density_norm = min(100.0, max(10.0, (math.log10(max(raw_audience, 10)) / 4.0) * 100.0))

        # 2. Poder Aquisitivo (0 a 100)
        power_norm = float(event.get("purchasing_power", 70))

        # 3. Probabilidade de Dinâmico (0 a 100)
        # Sincronização de saída eleva a probabilidade de multiplicador 1.5x - 2.5x
        surge_prob = float(event.get("dynamic_prob", 0.7)) * 100.0
        sync_dispersal = event.get("is_synchronized_dispersal", True)
        surge_multiplier = 1.15 if sync_dispersal else 0.85
        surge_norm = min(100.0, surge_prob * surge_multiplier)

        # 4. Potencial de Gorjeta / Comfort
        tips_factor = float(event.get("tips_factor", 0.5)) * 100.0

        # Score Base Ponderado
        raw_score = (
            self.w_density * density_norm +
            self.w_power * power_norm +
            self.w_surge * surge_norm +
            self.w_tips * tips_factor
        )

        # 5. Penalidades
        bottleneck_penalty = float(event.get("traffic_penalty", 0.15)) # 0.0 a 0.40
        deadhead_penalty = float(event.get("deadhead_penalty", 0.05))   # 0.0 a 0.50

        # 6. Proximidade Temporal
        peak_time_str = event.get("peak_window") or event.get("peak_time") or event.get("class_end_peak") or "22:00"
        time_factor = self.calculate_time_proximity_factor(peak_time_str, current_time)

        # Score Final com Limites [0, 100]
        final_score = raw_score * (1.0 - bottleneck_penalty) * (1.0 - deadhead_penalty) * time_factor
        final_score = round(min(100.0, max(0.0, final_score)), 1)

        # Classificação Tática
        if final_score >= 85:
            tier = "OURO (MÁXIMA RENTABILIDADE)"
            tier_color = "#10B981" # Emerald
            action_tag = "POSICIONAR AGORA"
        elif final_score >= 70:
            tier = "PRATA (ALTA DEMANDA)"
            tier_color = "#3B82F6" # Blue
            action_tag = "RADAR PRÓXIMO"
        elif final_score >= 50:
            tier = "BRONZE (REGULAR/VOLUME MÉDIO)"
            tier_color = "#F59E0B" # Amber
            action_tag = "MONITORAR"
        else:
            tier = "STANDBY (FRIA)"
            tier_color = "#6B7280" # Gray
            action_tag = "AGUARDAR HORÁRIO"

        return {
            **event,
            "calculated_score": final_score,
            "tier": tier,
            "tier_color": tier_color,
            "action_tag": action_tag,
            "time_proximity_multiplier": round(time_factor, 2),
            "breakdown": {
                "density_norm": round(density_norm, 1),
                "power_norm": round(power_norm, 1),
                "surge_norm": round(surge_norm, 1),
                "tips_factor": round(tips_factor, 1),
                "bottleneck_penalty_pct": f"{int(bottleneck_penalty * 100)}%",
                "deadhead_penalty_pct": f"{int(deadhead_penalty * 100)}%"
            }
        }

    def rank_events(self, events: List[Dict[str, Any]], current_time: datetime = None) -> List[Dict[str, Any]]:
        """
        Recebe a lista de eventos brutos do dia e retorna ordenada do melhor para o pior.
        """
        evaluated = [self.evaluate_opportunity(evt, current_time) for evt in events]
        return sorted(evaluated, key=lambda x: x["calculated_score"], reverse=True)
