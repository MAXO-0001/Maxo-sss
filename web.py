# -*- coding: utf-8 -*-
"""
پنل وب MAXO — یک داشبورد ادمین برای همون اکانت سلف که bot.py اجرا می‌کند.
این فایل روی یک ترد جدا (با waitress) اجرا می‌شود و برای اجرای هر عملیاتی که
به Telethon نیاز دارد، کوروتین‌ها را روی event loop اصلیِ bot.py می‌فرستد
(asyncio.run_coroutine_threadsafe) تا هیچ تداخلی با خود سلف پیش نیاید.
"""

import re
import hmac
import time
import asyncio
import secrets
from functools import wraps
from pathlib import Path

from flask import Flask, request, session, jsonify, send_from_directory, Response

import bot
import panel_utils

TAG_RE = re.compile(r"<[^>]+>")


def strip_html(s):
    return TAG_RE.sub("", s or "").strip()


def run_coro(coro, timeout=25):
    """یک کوروتینِ telethon رو از این ترد روی لوپ اصلی bot.py اجرا می‌کنه و نتیجه رو برمی‌گردونه."""
    if bot.MAIN_LOOP is None:
        raise RuntimeError("سلف هنوز به‌طور کامل بالا نیامده است.")
    future = asyncio.run_coroutine_threadsafe(coro, bot.MAIN_LOOP)
    return future.result(timeout=timeout)


def create_app():
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.secret_key = bot.PANEL_SECRET_KEY or secrets.token_hex(32)
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
    )

    # ---------------------------------------------------------
    # AUTH
    # ---------------------------------------------------------
    def login_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not session.get("authed"):
                return jsonify({"ok": False, "error": "auth_required"}), 401
            return view(*args, **kwargs)
        return wrapped

    @app.get("/login")
    def login_page():
        if session.get("authed"):
            return Response(_index_html(), mimetype="text/html")
        return Response(_read_template("login.html"), mimetype="text/html")

    @app.post("/api/login")
    def login_submit():
        data = request.get_json(silent=True) or request.form
        username = (data.get("username") or "").strip()
        password = (data.get("password") or "").strip()

        valid = (
            bool(bot.PANEL_USERNAME) and bool(bot.PANEL_PASSWORD)
            and hmac.compare_digest(username, bot.PANEL_USERNAME)
            and hmac.compare_digest(password, bot.PANEL_PASSWORD)
        )
        if not valid:
            time.sleep(0.6)  # جلوگیری ساده از brute-force سریع
            return jsonify({"ok": False, "error": "invalid_credentials"}), 401

        session.clear()
        session["authed"] = True
        session.permanent = True
        return jsonify({"ok": True})

    @app.post("/api/logout")
    def logout():
        session.clear()
        return jsonify({"ok": True})

    @app.get("/")
    def index():
        if not session.get("authed"):
            return Response(_read_template("login.html"), mimetype="text/html")
        return Response(_index_html(), mimetype="text/html")

    # ---------------------------------------------------------
    # STATS
    # ---------------------------------------------------------
    @app.get("/api/stats")
    @login_required
    def api_stats():
        return jsonify({"ok": True, "data": bot.panel_stats()})

    @app.get("/api/account")
    @login_required
    def api_account():
        try:
            info = run_coro(bot.account_info_dict())
            return jsonify({"ok": True, "data": info})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)[:300]}), 500

    @app.get("/api/fonts")
    @login_required
    def api_fonts():
        items = [{"id": k, "name": v} for k, v in sorted(bot.FONT_NAMES.items())]
        return jsonify({"ok": True, "data": items})

    # ---------------------------------------------------------
    # DELETE MESSAGES IN A PV
    # ---------------------------------------------------------
    @app.post("/api/delete-messages")
    @login_required
    def api_delete_messages():
        data = request.get_json(silent=True) or {}
        value = (data.get("value") or "").strip()
        try:
            count = int(data.get("count", 0))
        except (TypeError, ValueError):
            count = 0
        if not value or count <= 0:
            return jsonify({"ok": False, "error": "invalid_input"}), 400
        try:
            user = run_coro(bot.resolve_user(value))
            if not user:
                return jsonify({"ok": False, "error": "user_not_found"}), 404
            deleted = run_coro(bot.delete_messages_in_entity(user, count))
            if deleted < 0:
                return jsonify({"ok": False, "error": "delete_failed"}), 500
            return jsonify({"ok": True, "deleted": deleted})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)[:300]}), 500

    # ---------------------------------------------------------
    # AUTO REPLY
    # ---------------------------------------------------------
    @app.get("/api/auto-reply")
    @login_required
    def api_auto_reply_get():
        text = bot.get_setting("auto_text", "")
        style = bot.get_setting("auto_style", "as_typed")

        if style == "bold":
            html_value = f"<b>{panel_utils.html_lib.escape(text)}</b>" if text else ""
        elif style == "quote":
            html_value = f"<blockquote>{panel_utils.html_lib.escape(text)}</blockquote>" if text else ""
        else:
            entities = bot.load_auto_entities()
            html_value = panel_utils.entities_to_html(text, entities)

        return jsonify({
            "ok": True,
            "data": {
                "html": html_value,
                "enabled": bot.get_setting("auto_reply", "0") == "1",
            }
        })

    @app.post("/api/auto-reply")
    @login_required
    def api_auto_reply_save():
        data = request.get_json(silent=True) or {}
        html_content = data.get("html", "")
        plain_text, entities = panel_utils.html_to_text_entities(html_content)

        bot.set_setting("auto_text", plain_text)
        bot.set_auto_entities(entities)
        bot.set_setting("auto_style", "as_typed")
        return jsonify({"ok": True})

    @app.post("/api/auto-reply/toggle")
    @login_required
    def api_auto_reply_toggle():
        data = request.get_json(silent=True) or {}
        bot.set_setting("auto_reply", "1" if data.get("enabled") else "0")
        return jsonify({"ok": True})

    # ---------------------------------------------------------
    # NAME CLOCK
    # ---------------------------------------------------------
    @app.post("/api/name-clock")
    @login_required
    def api_name_clock():
        data = request.get_json(silent=True) or {}
        try:
            if data.get("enabled"):
                font = int(data.get("font", 1))
                label = (data.get("label") or "").strip() or None
                ok = run_coro(bot.enable_name_clock(font=font, label=label))
            else:
                run_coro(bot.disable_name_clock())
                ok = True
            return jsonify({"ok": ok})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)[:300]}), 500

    # ---------------------------------------------------------
    # BIO CLOCK
    # ---------------------------------------------------------
    @app.post("/api/bio-clock")
    @login_required
    def api_bio_clock():
        data = request.get_json(silent=True) or {}
        try:
            if data.get("enabled"):
                font = int(data.get("font", 1))
                ok = run_coro(bot.enable_bio_clock(font))
            else:
                run_coro(bot.disable_bio_clock())
                ok = True
            return jsonify({"ok": ok})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)[:300]}), 500

    # ---------------------------------------------------------
    # ARCHIVE TOGGLE
    # ---------------------------------------------------------
    @app.post("/api/archive-toggle")
    @login_required
    def api_archive_toggle():
        data = request.get_json(silent=True) or {}
        bot.set_setting("archive_enabled", "1" if data.get("enabled") else "0")
        return jsonify({"ok": True})

    # ---------------------------------------------------------
    # BLOCK LIST
    # ---------------------------------------------------------
    @app.get("/api/blocklist")
    @login_required
    def api_blocklist():
        rows = bot.db.execute(
            "SELECT user_id, username, name, created_at FROM blocked ORDER BY created_at DESC"
        ).fetchall()
        items = [
            {"user_id": r[0], "username": r[1], "name": r[2], "created_at": r[3]}
            for r in rows
        ]
        return jsonify({"ok": True, "data": items})

    @app.post("/api/block")
    @login_required
    def api_block():
        data = request.get_json(silent=True) or {}
        value = (data.get("value") or "").strip()
        if not value:
            return jsonify({"ok": False, "error": "empty_value"}), 400
        try:
            user = run_coro(bot.resolve_user(value))
            result = run_coro(bot.block_user(user))
            ok = bool(user) and "🚫" in result
            return jsonify({"ok": ok, "message": strip_html(result)})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)[:300]}), 500

    @app.post("/api/unblock")
    @login_required
    def api_unblock():
        data = request.get_json(silent=True) or {}
        value = (data.get("value") or "").strip()
        if not value:
            return jsonify({"ok": False, "error": "empty_value"}), 400
        try:
            user = run_coro(bot.resolve_user(value))
            result = run_coro(bot.unblock_user(user))
            ok = bool(user) and "🟢" in result
            return jsonify({"ok": ok, "message": strip_html(result)})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)[:300]}), 500

    # ---------------------------------------------------------
    # MUTE LIST
    # ---------------------------------------------------------
    @app.get("/api/mutelist")
    @login_required
    def api_mutelist():
        rows = bot.db.execute(
            "SELECT user_id, username, name, created_at FROM muted ORDER BY created_at DESC"
        ).fetchall()
        items = [
            {"user_id": r[0], "username": r[1], "name": r[2], "created_at": r[3]}
            for r in rows
        ]
        return jsonify({"ok": True, "data": items})

    @app.post("/api/mute")
    @login_required
    def api_mute():
        data = request.get_json(silent=True) or {}
        value = (data.get("value") or "").strip()
        if not value:
            return jsonify({"ok": False, "error": "empty_value"}), 400
        try:
            user = run_coro(bot.resolve_user(value))
            if not user:
                return jsonify({"ok": False, "error": "user_not_found"}), 404
            bot.add_mute(user)
            return jsonify({"ok": True})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)[:300]}), 500

    @app.post("/api/unmute")
    @login_required
    def api_unmute():
        data = request.get_json(silent=True) or {}
        user_id = data.get("user_id")
        if not user_id:
            return jsonify({"ok": False, "error": "missing_user_id"}), 400
        bot.remove_mute(user_id)
        return jsonify({"ok": True})

    # ---------------------------------------------------------
    # CHATS (لیست مکالمات)
    # ---------------------------------------------------------
    @app.get("/api/chats")
    @login_required
    def api_chats():
        rows = bot.db.execute("""
        SELECT user_id, username, name, received, replies, last_message, last_seen
        FROM chats ORDER BY last_seen DESC LIMIT 100
        """).fetchall()
        items = [
            {
                "user_id": r[0], "username": r[1], "name": r[2],
                "received": r[3], "replies": r[4],
                "last_message": r[5], "last_seen": r[6],
            }
            for r in rows
        ]
        return jsonify({"ok": True, "data": items})

    # ---------------------------------------------------------
    # DELETED MESSAGES ARCHIVE
    # ---------------------------------------------------------
    @app.get("/api/deleted")
    @login_required
    def api_deleted():
        try:
            page = max(1, int(request.args.get("page", 1)))
        except ValueError:
            page = 1
        page_size = 25
        offset = (page - 1) * page_size

        total = bot.db.execute("SELECT COUNT(*) FROM deleted_log").fetchone()[0]
        rows = bot.db.execute("""
        SELECT id, chat_id, sender_id, name, username, text, media_type, media_path, created_at, deleted_at
        FROM deleted_log ORDER BY id DESC LIMIT ? OFFSET ?
        """, (page_size, offset)).fetchall()

        items = []
        for r in rows:
            (log_id, chat_id, sender_id, name, username, text,
             media_type, media_path, created_at, deleted_at) = r
            items.append({
                "id": log_id,
                "chat_id": chat_id,
                "sender_id": sender_id,
                "name": name,
                "username": username,
                "text": text,
                "media_type": media_type,
                "has_media": bool(media_path),
                "created_at": created_at,
                "deleted_at": deleted_at,
            })

        return jsonify({
            "ok": True,
            "data": items,
            "page": page,
            "page_size": page_size,
            "total": total,
        })

    @app.get("/media/deleted/<int:log_id>")
    @login_required
    def media_deleted(log_id):
        row = bot.db.execute(
            "SELECT media_path FROM deleted_log WHERE id=?", (log_id,)
        ).fetchone()
        if not row or not row[0]:
            return jsonify({"ok": False, "error": "not_found"}), 404

        media_path = Path(row[0]).resolve()
        base_dir = bot.DELETED_MEDIA_DIR.resolve()
        try:
            media_path.relative_to(base_dir)
        except ValueError:
            return jsonify({"ok": False, "error": "forbidden"}), 403

        if not media_path.exists():
            return jsonify({"ok": False, "error": "gone"}), 404

        return send_from_directory(base_dir, media_path.name)

    return app


def _read_template(name):
    path = Path(__file__).parent / "templates" / name
    return path.read_text(encoding="utf-8")


def _index_html():
    return _read_template("dashboard.html")
