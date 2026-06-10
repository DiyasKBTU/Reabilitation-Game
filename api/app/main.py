from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import connect_db, close_db
from .routes import auth, patients, sessions, insights, leaderboard, profile, admin
from .ml.router import router as ml_router
from .ml.anomaly import preload_model


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    preload_model()
    await _seed_admin()
    if settings.demo_mode:
        from .demo import seed_demo
        await seed_demo()
    yield
    await close_db()


async def _seed_admin():
    if not settings.admin_password:
        return
    from .models.user import User
    from .auth.password import hash_password
    existing = await User.find_one(User.username == settings.admin_username)
    if not existing:
        admin = User(
            username=settings.admin_username,
            email=settings.admin_email,
            password_hash=hash_password(settings.admin_password),
            role="admin",
        )
        await admin.insert()


app = FastAPI(
    title="RehabGame API",
    version=settings.version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(patients.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(insights.router, prefix="/api")
app.include_router(leaderboard.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(ml_router, prefix="/api")


@app.get("/api/health")
async def health():
    from .ml.anomaly import _load_model
    model = _load_model()
    return {
        "status": "ok",
        "version": settings.version,
        "anomaly_mode": "ml" if model else "rule",
        "model_version": model.get("model_version") if model else None,
        "demo_mode": settings.demo_mode,
    }
