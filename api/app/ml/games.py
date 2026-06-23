"""
Карта управляющих осей по типу игры.

Признаки движения считаются по тем осям, которыми пациент управляет в игре.
- game1 (Space Catcher) — наклон кисти влево/вправо = roll
- game2 (City Driver)   — руление наклоном вбок = roll + газ/тормоз наклоном вперёд/назад = pitch

ЕДИНЫЙ ИСТОЧНИК — `ANALYZED_AXES`: упорядоченный список (ось, подпись) на игру. ПЕРВАЯ ось —
ОСНОВНАЯ: на ней строятся рекомендации и нарратив, её признаки лежат в `Session.features`.
ОСТАЛЬНЫЕ оси анализируются ТЕМ ЖЕ детектором аномалий (`extract_features`/модель —
axis-agnostic: один и тот же 16-мерный вектор по любой оси) и агрегируются в общий вердикт
(`ml/multiaxis.py`). Их признаки лежат в `Session.axis_features[ось]`.

Раньше pitch был «вторичным» и в модель не шёл; теперь он полноценно анализируется — модель не
переобучалась, т.к. она axis-agnostic. Добавить игру/ось — дописать запись в `ANALYZED_AXES`,
роуты sessions/insights подхватят оси автоматически.
"""

DEFAULT_AXIS = "r"

# Упорядоченный список анализируемых осей по игре: (ось, человекочитаемая подпись).
ANALYZED_AXES = {
    "game1": [("r", "Наклон кисти вбок")],
    "game2": [("r", "Руль (наклон кисти вбок)"), ("p", "Газ/тормоз (наклон вперёд/назад)")],
}

# Совместимость со старым API/доками (производные от ANALYZED_AXES — единый источник истины).
GAME_AXIS = {gt: axes[0][0] for gt, axes in ANALYZED_AXES.items()}
SECONDARY_AXES = {gt: {ax: label for ax, label in axes[1:]}
                  for gt, axes in ANALYZED_AXES.items() if len(axes) > 1}


def analyzed_axes_for_game(game_type: str) -> list[tuple[str, str]]:
    """Все анализируемые оси игры: [(ось, подпись), ...]. Первая — основная."""
    return ANALYZED_AXES.get(game_type, [(DEFAULT_AXIS, "Движение")])


def axis_for_game(game_type: str) -> str:
    """Основная ось игры (на ней рекомендации/нарратив)."""
    return analyzed_axes_for_game(game_type)[0][0]


def secondary_axes_for_game(game_type: str) -> dict:
    """Неосновные анализируемые оси: {ось: подпись}. Пусто, если игра одноосевая.

    Их признаки хранятся в `Session.axis_features` (считаются при сохранении сессии).
    """
    return {ax: label for ax, label in analyzed_axes_for_game(game_type)[1:]}
