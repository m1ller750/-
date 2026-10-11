"""Бизнес-модель ТурниРУМ.

Каждая команда платного турнира оплачивает взнос. Общая выручка турнира делится так:
  • PLATFORM_FEE_PERCENT (10 %) — создателю платформы;
  • prize_percent — в призовой фонд (организатор выбирает сам, от 0 до 90 %);
  • всё остальное — организатору.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Split:
    total: int = 0
    prize: int = 0
    organizer: int = 0
    platform: int = 0
    prize_percent: int = 0
    organizer_percent: int = 0
    platform_percent: int = 0

    def __add__(self, other):
        return Split(
            total=self.total + other.total,
            prize=self.prize + other.prize,
            organizer=self.organizer + other.organizer,
            platform=self.platform + other.platform,
        ).with_percents()

    def with_percents(self):
        """Фактические доли — нужны для суммарных показателей по нескольким турнирам."""
        if not self.total:
            return self
        prize_percent = round(self.prize * 100 / self.total)
        platform_percent = round(self.platform * 100 / self.total)
        return Split(self.total, self.prize, self.organizer, self.platform,
                     prize_percent, 100 - prize_percent - platform_percent, platform_percent)


def _percent_of(total, percent):
    return (total * percent + 50) // 100


def split_revenue(total, prize_percent, platform_percent=10):
    platform_percent = max(0, min(100, int(platform_percent)))
    prize_percent = max(0, min(100 - platform_percent, int(prize_percent)))
    total = max(0, int(total))
    platform = _percent_of(total, platform_percent)
    prize = _percent_of(total, prize_percent)
    # Организатор получает остаток, поэтому сумма частей всегда равна выручке.
    organizer = total - platform - prize
    return Split(total, prize, organizer, platform,
                 prize_percent, 100 - platform_percent - prize_percent, platform_percent)


def tournament_finance(t, platform_percent=10):
    """Деньги турнира: уже собрано, ожидает подтверждения и максимум при полном составе."""
    fee = t["entry_fee"] if t["is_paid"] else 0
    paid, teams, max_teams = t["paid_count"], t["team_count"], t["max_teams"]
    pp, prize = platform_percent, t["prize_percent"]
    return {
        "fee": fee,
        "collected": split_revenue(fee * paid, prize, pp),
        "expected": split_revenue(fee * teams, prize, pp),
        "potential": split_revenue(fee * max(max_teams, teams), prize, pp),
        "pending_amount": fee * max(0, teams - paid),
        "pending_teams": max(0, teams - paid) if fee else 0,
    }


def total_split(splits):
    result = Split()
    for s in splits:
        result = result + s
    return result
