from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from playwright.async_api import Browser, BrowserContext, Page, async_playwright


DEFAULT_URL = "http://learnning.pivastoday.com/s/UAOYuk?tag_userId=&tag_activityId="
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/AP2A.240705.005; wv) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 "
    "Mobile Safari/537.36 MicroMessenger/8.0.49.2600(0x2800313D) WeChat/arm64"
)
PROJECT_ENDPOINT = "/api/public/loadProject"


@dataclass(frozen=True)
class Question:
    position: int
    external_id: str
    kind: str
    stem: str
    options: list[str]
    correct_answers: list[str]
    analysis_text: str
    raw_json: str
    fingerprint: str


class HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag in {"br", "li", "p", "div"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"li", "p", "div"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def normalized(text: str) -> str:
    return " ".join(text.replace("\u00a0", " ").split())


def html_to_text(value: Any) -> str:
    if value is None:
        return ""
    parser = HtmlTextExtractor()
    parser.feed(str(value))
    return normalized("".join(parser.parts))


def as_text_list(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    values = value if isinstance(value, list) else [value]
    return [text for item in values if (text := html_to_text(item))]


def question_fingerprint(stem: str, options: list[str]) -> str:
    payload = json.dumps(
        {"stem": normalized(stem), "options": [normalized(item) for item in options]},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def connect_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY,
            source_url TEXT NOT NULL,
            project_id TEXT NOT NULL,
            random_answer_id TEXT NOT NULL,
            page_title TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            response_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY,
            first_collection_id INTEGER NOT NULL
                REFERENCES collections(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            external_id TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL,
            stem TEXT NOT NULL,
            options_json TEXT NOT NULL,
            correct_answer_json TEXT NOT NULL,
            analysis_text TEXT NOT NULL,
            raw_question_json TEXT NOT NULL,
            fingerprint TEXT NOT NULL UNIQUE,
            captured_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS question_tags (
            question_id INTEGER NOT NULL
                REFERENCES questions(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            PRIMARY KEY (question_id, tag)
        );
        """
    )
    tag_count = connection.execute("SELECT COUNT(*) FROM question_tags").fetchone()[0]
    question_count = connection.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    if question_count and not tag_count:
        with connection:
            connection.execute(
                "INSERT INTO question_tags (question_id, tag) "
                "SELECT id, '处方审核' FROM questions"
            )
    return connection


def extract_options(node: dict[str, Any]) -> tuple[list[str], dict[str, str]]:
    options: list[str] = []
    option_titles: dict[str, str] = {}
    for child in node.get("children") or []:
        if not isinstance(child, dict):
            continue
        attribute = child.get("attribute") or {}
        text = html_to_text(
            child.get("title")
            or attribute.get("label")
            or attribute.get("text")
            or attribute.get("option")
        )
        if text:
            options.append(text)
            option_id = str(child.get("id") or "").strip()
            if option_id:
                option_titles[option_id] = text
    return list(dict.fromkeys(options)), option_titles


def extract_correct_answers(
    node: dict[str, Any], option_titles: dict[str, str]
) -> list[str]:
    attribute = node.get("attribute") or {}
    answers = as_text_list(attribute.get("examCorrectAnswer"))
    for child in node.get("children") or []:
        if not isinstance(child, dict):
            continue
        child_attribute = child.get("attribute") or {}
        answers.extend(as_text_list(child_attribute.get("examCorrectAnswer")))
    return list(dict.fromkeys(option_titles.get(answer, answer) for answer in answers))


def extract_questions(payload: dict[str, Any]) -> tuple[dict[str, Any], list[Question]]:
    data = payload.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("loadProject 未返回有效 data")
    survey = data.get("survey")
    if not isinstance(survey, dict) or not isinstance(survey.get("children"), list):
        raise RuntimeError("loadProject 未返回题目列表")

    questions: list[Question] = []
    for position, node in enumerate(survey["children"], start=1):
        if not isinstance(node, dict):
            continue
        kind = str(node.get("type") or "unknown")
        if kind == "Remark":
            continue
        external_id = str(node.get("id") or "").strip()
        stem = html_to_text(node.get("title"))
        if not external_id or not stem:
            continue
        options, option_titles = extract_options(node)
        attribute = node.get("attribute") or {}
        analysis_text = html_to_text(attribute.get("examAnalysis"))
        correct_answers = extract_correct_answers(node, option_titles)
        questions.append(
            Question(
                position=position,
                external_id=external_id,
                kind=kind,
                stem=stem,
                options=options,
                correct_answers=correct_answers,
                analysis_text=analysis_text,
                raw_json=json.dumps(node, ensure_ascii=False, separators=(",", ":")),
                fingerprint=question_fingerprint(stem, options),
            )
        )
    if not questions:
        raise RuntimeError("loadProject 中没有可识别题目")
    return data, questions


def new_questions(
    connection: sqlite3.Connection, questions: list[Question]
) -> list[Question]:
    ids = [question.external_id for question in questions]
    fingerprints = [question.fingerprint for question in questions]
    id_marks = ",".join("?" for _ in ids)
    fingerprint_marks = ",".join("?" for _ in fingerprints)
    rows = connection.execute(
        f"""
        SELECT external_id, fingerprint
        FROM questions
        WHERE external_id IN ({id_marks}) OR fingerprint IN ({fingerprint_marks})
        """,
        [*ids, *fingerprints],
    )
    known_ids: set[str] = set()
    known_fingerprints: set[str] = set()
    for row in rows:
        known_ids.add(row["external_id"])
        known_fingerprints.add(row["fingerprint"])
    return [
        question
        for question in questions
        if question.external_id not in known_ids
        and question.fingerprint not in known_fingerprints
    ]


def persist_collection(
    connection: sqlite3.Connection,
    source_url: str,
    page_title: str,
    payload: dict[str, Any],
    questions: list[Question],
    tag: str,
) -> int:
    fresh = new_questions(connection, questions)
    data = payload["data"]
    captured_at = datetime.now(timezone.utc).isoformat()
    with connection:
        if fresh:
            cursor = connection.execute(
                """
                INSERT INTO collections (
                    source_url, project_id, random_answer_id, page_title,
                    captured_at, response_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    source_url,
                    str(data.get("id") or ""),
                    str(data.get("randomAnswerId") or ""),
                    page_title,
                    captured_at,
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                ),
            )
            collection_id = cursor.lastrowid
            connection.executemany(
                """
                INSERT INTO questions (
                    first_collection_id, position, external_id, kind, stem,
                    options_json, correct_answer_json, analysis_text,
                    raw_question_json, fingerprint, captured_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        collection_id,
                        question.position,
                        question.external_id,
                        question.kind,
                        question.stem,
                        json.dumps(question.options, ensure_ascii=False),
                        json.dumps(question.correct_answers, ensure_ascii=False),
                        question.analysis_text,
                        question.raw_json,
                        question.fingerprint,
                        captured_at,
                    )
                    for question in fresh
                ],
            )
        for question in questions:
            row = connection.execute(
                """
                SELECT id FROM questions
                WHERE external_id = ? OR fingerprint = ?
                LIMIT 1
                """,
                (question.external_id, question.fingerprint),
            ).fetchone()
            if row:
                connection.execute(
                    "INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?, ?)",
                    (row["id"], tag),
                )
    return len(fresh)


async def open_browser(
    playwright: Any, headed: bool, user_agent: str
) -> tuple[Browser, BrowserContext]:
    browser = await playwright.chromium.launch(headless=not headed)
    context = await browser.new_context(
        locale="zh-CN",
        user_agent=user_agent,
        viewport={"width": 390, "height": 844},
        screen={"width": 390, "height": 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
        extra_http_headers={"Accept-Language": "zh-CN,zh;q=0.9"},
    )
    return browser, context


async def load_project(page: Page, url: str, timeout_ms: int) -> dict[str, Any]:
    async with page.expect_response(
        lambda response: response.url.endswith(PROJECT_ENDPOINT),
        timeout=timeout_ms,
    ) as pending_response:
        response = await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    if response and response.status >= 400:
        raise RuntimeError(f"目标页返回 HTTP {response.status}")
    project_response = await pending_response.value
    if project_response.status >= 400:
        raise RuntimeError(f"loadProject 返回 HTTP {project_response.status}")
    payload = await project_response.json()
    if payload.get("code") != 200:
        raise RuntimeError(f"loadProject 返回异常: {payload}")
    return payload


async def crawl(args: argparse.Namespace) -> None:
    parsed = urlparse(args.url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("URL 必须是完整的 http/https 地址")

    database_path = Path(args.database).resolve()
    with closing(connect_database(database_path)) as connection:
        total = connection.execute(
            "SELECT COUNT(*) FROM question_tags WHERE tag = ?", (args.tag,)
        ).fetchone()[0]
        stale_rounds = 0
        attempts = 0
        async with async_playwright() as playwright:
            browser, context = await open_browser(
                playwright, args.headed, args.user_agent
            )
            try:
                page = await context.new_page()
                while attempts < args.max_attempts:
                    if args.count and total >= args.count:
                        break
                    if stale_rounds >= args.stale_rounds:
                        break

                    attempts += 1
                    payload = await load_project(page, args.url, args.timeout * 1000)
                    data, questions = extract_questions(payload)
                    added = persist_collection(
                        connection=connection,
                        source_url=args.url,
                        page_title=str(data.get("name") or await page.title()),
                        payload=payload,
                        questions=questions,
                        tag=args.tag,
                    )
                    total = connection.execute(
                        "SELECT COUNT(*) FROM question_tags WHERE tag = ?",
                        (args.tag,),
                    ).fetchone()[0]
                    stale_rounds = 0 if added else stale_rounds + 1
                    print(
                        f"[{attempts}] 本轮新增 {added}，累计 {total}，"
                        f"连续无新增 {stale_rounds}/{args.stale_rounds}",
                        flush=True,
                    )
                    if args.interval and attempts < args.max_attempts:
                        await asyncio.sleep(args.interval)
            finally:
                await context.close()
                await browser.close()

        if args.count and total < args.count:
            raise RuntimeError(
                f"达到停止条件，仅采集 {total}/{args.count} 道唯一题目"
            )
        if not args.count and stale_rounds < args.stale_rounds:
            raise RuntimeError(
                f"达到最大刷新次数 {args.max_attempts}，尚未满足收敛条件"
            )
        print(f"采集结束：共 {total} 道唯一题目")


def export_json(args: argparse.Namespace) -> None:
    database_path = Path(args.database).resolve()
    if not database_path.exists():
        raise FileNotFoundError(f"数据库不存在: {database_path}")

    with closing(connect_database(database_path)) as connection:
        rows = connection.execute(
            """
            SELECT id, external_id, kind, stem, options_json,
                   correct_answer_json, analysis_text, captured_at
            FROM questions
            ORDER BY id
            """
        ).fetchall()
        data = [dict(row) for row in rows]
        for item in data:
            item["options"] = json.loads(item.pop("options_json"))
            item["correct_answers"] = json.loads(item.pop("correct_answer_json"))

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"已导出 {len(data)} 道题到 {output_path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="题目与答案解析采集器")
    subparsers = parser.add_subparsers(dest="command", required=True)

    crawl_parser = subparsers.add_parser("crawl", help="刷新采集题目及答案解析")
    crawl_parser.add_argument("--url", default=DEFAULT_URL)
    crawl_parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    crawl_parser.add_argument("--database", default="questions.sqlite3")
    crawl_parser.add_argument("--tag", required=True)
    crawl_parser.add_argument("--count", type=int, default=0)
    crawl_parser.add_argument("--stale-rounds", type=int, default=50)
    crawl_parser.add_argument("--max-attempts", type=int, default=1000)
    crawl_parser.add_argument("--interval", type=float, default=1.0)
    crawl_parser.add_argument("--timeout", type=int, default=30)
    crawl_parser.add_argument("--headed", action="store_true")
    crawl_parser.set_defaults(handler=lambda options: asyncio.run(crawl(options)))

    export_parser = subparsers.add_parser("export", help="将 SQLite 数据导出为 JSON")
    export_parser.add_argument("--database", default="questions.sqlite3")
    export_parser.add_argument("--output", default="questions.json")
    export_parser.set_defaults(handler=export_json)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if hasattr(args, "tag") and not args.tag.strip():
        raise ValueError("tag 不能为空")
    if getattr(args, "count", 0) < 0:
        raise ValueError("count 不能小于 0")
    if getattr(args, "stale_rounds", 1) <= 0:
        raise ValueError("stale-rounds 必须大于 0")
    if getattr(args, "max_attempts", 1) <= 0:
        raise ValueError("max-attempts 必须大于 0")
    args.handler(args)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("已停止", file=sys.stderr)
        raise SystemExit(130)
    except Exception as error:
        print(f"错误: {error}", file=sys.stderr)
        raise SystemExit(1)
