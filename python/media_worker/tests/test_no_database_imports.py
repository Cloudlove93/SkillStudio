from __future__ import annotations

import ast
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PROJECT_ROOT / "src" / "media_worker"
PYPROJECT_PATH = PROJECT_ROOT / "pyproject.toml"
FORBIDDEN_IMPORTS = {"psycopg", "sqlalchemy", "asyncpg", "pg8000", "sqlite3"}
FORBIDDEN_ENV_MARKERS = {
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "POSTGRES_HOST",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "PGHOST",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
}


def iter_import_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        if isinstance(node, ast.ImportFrom) and node.module:
            roots.add(node.module.split(".")[0])
    return roots


def test_worker_source_has_no_database_imports() -> None:
    for path in SOURCE_ROOT.rglob("*.py"):
        assert iter_import_roots(path).isdisjoint(FORBIDDEN_IMPORTS)


def test_worker_source_does_not_reference_database_environment_variables() -> None:
    for path in SOURCE_ROOT.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for marker in FORBIDDEN_ENV_MARKERS:
            assert marker not in text


def test_pyproject_has_no_database_driver_dependencies() -> None:
    text = PYPROJECT_PATH.read_text(encoding="utf-8")
    for forbidden in FORBIDDEN_IMPORTS:
        assert forbidden not in text
