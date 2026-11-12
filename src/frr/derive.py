"""Safe arithmetic for derivations (e.g. a yield spread from two evidence values).

Formulas are plain arithmetic over named inputs: ``(a - b) * 100``, ``abs(d)``. Only numbers,
names, + - * /, unary minus, parentheses and ``abs``/``round`` are allowed; anything else raises
``ValueError``. No ``eval``.
"""

from __future__ import annotations

import ast
import math
import operator

_BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
_UNARY = {ast.USub: operator.neg, ast.UAdd: operator.pos}
_CALLS = {"abs": abs, "round": round}


def names(formula: str) -> set[str]:
    """Input names a formula reads (raises ValueError when the formula is not allowed)."""
    tree = _parse(formula)
    return {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and n.id not in _CALLS}


def evaluate(formula: str, env: dict[str, float]) -> float:
    def ev(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id not in env:
                raise ValueError(f"unknown input '{node.id}'")
            return float(env[node.id])
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            return _BIN[type(node.op)](ev(node.left), ev(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
            return _UNARY[type(node.op)](ev(node.operand))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _CALLS and not node.keywords:
            return float(_CALLS[node.func.id](*(ev(a) for a in node.args)))
        raise ValueError(f"not allowed in a formula: {ast.dump(node)[:60]}")

    out = ev(_parse(formula))
    if not math.isfinite(out):
        raise ValueError("formula result is not a finite number")
    return out


def matches(computed: float, stated: float, rounding: int | None) -> bool:
    """True when ``stated`` is ``computed`` rounded to ``rounding`` decimals (or equal within 1e-9)."""
    if rounding is None:
        return abs(computed - stated) <= 1e-9
    return abs(computed - stated) <= 0.5 * 10 ** -rounding + 1e-9


def _parse(formula: str) -> ast.Expression:
    if len(formula) > 200:
        raise ValueError("formula is too long")
    try:
        tree = ast.parse(formula, mode="eval")
    except SyntaxError as exc:
        raise ValueError(f"formula does not parse: {exc.msg}") from None
    for node in ast.walk(tree):
        ok = isinstance(node, (ast.Expression, ast.Constant, ast.Name, ast.Load, ast.BinOp, ast.UnaryOp, ast.Call)) \
            or type(node) in _BIN or type(node) in _UNARY
        if not ok:
            raise ValueError(f"not allowed in a formula: {type(node).__name__}")
        if isinstance(node, ast.Call) and not (isinstance(node.func, ast.Name) and node.func.id in _CALLS):
            raise ValueError("only abs() and round() may be called")
    return tree
