from fastapi import APIRouter, Depends, Query
from typing import List
from ..models.score import Score
from ..models.user import User
from ..auth.deps import get_current_user

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("")
async def get_leaderboard(
    game_type: str = Query("game1"),
    limit: int = Query(20, le=100),
    user: User = Depends(get_current_user),
):
    scores = (
        await Score.find(Score.game_type == game_type)
        .sort("-score")
        .limit(limit)
        .to_list()
    )
    result = []
    for i, s in enumerate(scores):
        result.append({
            "rank": i + 1,
            "username": s.username,
            "patient_id": str(s.patient_id),
            "score": s.score,
            "created_at": s.created_at.isoformat(),
        })
    return result
