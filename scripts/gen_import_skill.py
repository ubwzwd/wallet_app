#!/usr/bin/env python3
"""从 backend/app/core/categories.py 生成 skills/wallet-import/ 下的三份交付物。

    python scripts/gen_import_skill.py            # 生成
    python scripts/gen_import_skill.py --check    # 只校验生成物是最新的（CI 用）

生成物必须提交进仓库：用户是从仓库或应用内的导入指南页拿文本的。
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from app.core.categories import CATEGORY_VERSION, EXPENSE_CATEGORIES, INCOME_CATEGORIES

ROOT = pathlib.Path(__file__).resolve().parents[1]
TPL = ROOT / "scripts" / "templates"
OUT = ROOT / "skills" / "wallet-import"


def render_group(cats) -> str:
    """渲染成 SKILL.md 里的那张表：一级 code / 名称 / 判据 / 二级 code。
    判据取 desc_zh（决策 §1.3、§14.21）——它就是给整理账单的人看的归类判据。"""
    lines = ["| 一级 code | 名称 | 判据 | 二级 code |", "|---|---|---|---|"]
    for c in cats:
        subs = "、".join(f"`{s.code}` {s.name_zh}" for s in c.children) or "—"
        lines.append(f"| `{c.code}` | {c.name_zh} | {c.desc_zh} | {subs} |")
    return "\n".join(lines)


def render(template_name: str) -> str:
    text = (TPL / template_name).read_text(encoding="utf-8")
    return (text
            .replace("{{CATEGORY_VERSION}}", CATEGORY_VERSION)
            .replace("{{EXPENSE_TABLE}}", render_group(EXPENSE_CATEGORIES))
            .replace("{{INCOME_TABLE}}", render_group(INCOME_CATEGORIES))
            # 规则与交付说明是两份包装共用的片段（§5.1），"逐字相同"靠这两行保证
            .replace("{{RULES}}", (TPL / "_rules.md").read_text(encoding="utf-8"))
            .replace("{{DELIVERY}}", (TPL / "_delivery.md").read_text(encoding="utf-8")))


TARGETS = {
    "SKILL.md": "SKILL.md.tpl",
    "chatgpt-instructions.md": "chatgpt-instructions.md.tpl",
    "example.csv": "example.csv.tpl",  # 只替换版本行
}


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for out_name, tpl_name in TARGETS.items():
        want, path = render(tpl_name), OUT / out_name
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != want:
                stale.append(out_name)
        else:
            path.write_text(want, encoding="utf-8")
            print(f"wrote {path.relative_to(ROOT)}  (version {CATEGORY_VERSION})")
    if stale:
        print("以下文件与 categories.py 不同步，请跑 scripts/gen_import_skill.py："
              + "、".join(stale), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
