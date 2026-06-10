"""
Запускает обучение модели напрямую из .py файлов, минуя кэш __pycache__.
Использование:  python run_train.py   (из папки ml-service)
"""
import importlib.machinery
import importlib.util
import sys
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)


def load_py(full_mod_name: str, rel_path: str):
    """Загружает .py файл напрямую, игнорируя .pyc."""
    abs_path = os.path.join(ROOT, rel_path)
    loader = importlib.machinery.SourceFileLoader(full_mod_name, abs_path)
    spec = importlib.util.spec_from_loader(full_mod_name, loader,
                                           origin=abs_path)
    spec.submodule_search_locations = []
    mod = importlib.util.module_from_spec(spec)
    sys.modules[full_mod_name] = mod
    loader.exec_module(mod)
    return mod


# Порядок важен: сначала зависимости, потом модули которые их используют
load_py("app",                   os.path.join("app", "__init__.py"))
load_py("app.features",          os.path.join("app", "features.py"))
load_py("app.anomaly",           os.path.join("app", "anomaly.py"))
load_py("app.recommendations",   os.path.join("app", "recommendations.py"))
load_py("data",                  os.path.join("data", "__init__.py"))
load_py("data.synthetic",        os.path.join("data", "synthetic.py"))
load_py("data.real_data_loader", os.path.join("data", "real_data_loader.py"))

# Патч: заменяем relative-импорт в train.py через уже загруженный модуль
import app.features  # noqa — теперь в sys.modules
train_path = os.path.join(ROOT, "app", "train.py")
with open(train_path, "r", encoding="utf-8") as f:
    src = f.read()

# Заменяем относительный импорт на абсолютный перед exec
src = src.replace("from .features import", "from app.features import")
src = src.replace("from data.synthetic import", "from data.synthetic import")
src = src.replace("from data.real_data_loader import", "from data.real_data_loader import")

ns = {"__name__": "__main__", "__file__": train_path, "__package__": "app"}
exec(compile(src, train_path, "exec"), ns)
ns["main"]()
