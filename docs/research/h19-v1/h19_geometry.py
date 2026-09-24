#!/usr/bin/env python3
"""Reproduce the frozen H19 v1 binary geometry and raw combinatorial coverage."""

from itertools import combinations, product

AXES = tuple(f"D{i}" for i in range(6))
HOLDOUTS = {("D0", "D3"), ("D1", "D4"), ("D2", "D5")}


def pair_key(a, b):
    return tuple(sorted((a, b), key=lambda x: int(x[1:])))


def cyclic_distance(i, j, n=6):
    d = abs(i - j)
    return min(d, n - d)


def h19_rows():
    rows = [tuple(0 for _ in AXES)]
    for i in range(6):
        row = [0] * 6
        row[i] = 1
        rows.append(tuple(row))
    for i, j in combinations(range(6), 2):
        if cyclic_distance(i, j) in (1, 2):
            row = [0] * 6
            row[i] = row[j] = 1
            rows.append(tuple(row))
    assert len(rows) == 19
    assert len(set(rows)) == 19
    return rows


def t_way_coverage(rows, strength):
    covered = 0
    total = 0
    for cols in combinations(range(6), strength):
        seen = {tuple(row[c] for c in cols) for row in rows}
        for values in product((0, 1), repeat=strength):
            total += 1
            if values in seen:
                covered += 1
    return covered, total


def support_metrics(rows):
    single_fanout = []
    for i in range(6):
        single_fanout.append(sum(row[i] == 1 for row in rows))

    selected_pairs = []
    pair_fanout = []
    covered_supports = 6
    for i, j in combinations(range(6), 2):
        fanout = sum(row[i] == row[j] == 1 for row in rows)
        if fanout:
            selected_pairs.append((AXES[i], AXES[j]))
            pair_fanout.append(fanout)
            covered_supports += 1

    missing_pairs = {
        pair_key(AXES[i], AXES[j])
        for i, j in combinations(range(6), 2)
        if sum(row[i] == row[j] == 1 for row in rows) == 0
    }
    return single_fanout, selected_pairs, pair_fanout, covered_supports, missing_pairs


def main():
    rows = h19_rows()
    print(f"rows={len(rows)}")
    for strength in range(1, 5):
        covered, total = t_way_coverage(rows, strength)
        print(f"t{strength}={covered}/{total}")

    singles, pairs, pair_fanout, support_covered, missing = support_metrics(rows)
    assert singles == [5] * 6
    assert pair_fanout == [1] * 12
    assert support_covered == 18
    assert missing == HOLDOUTS

    print(f"single_fanout_avg={sum(singles) / len(singles):.1f}")
    print(f"covered_pair_fanout_avg={sum(pair_fanout) / len(pair_fanout):.1f}")
    print(f"support_coverage={support_covered}/21")
    print("holdouts=" + ",".join("x".join(p) for p in sorted(missing)))

    expected = {
        1: (12, 12),
        2: (57, 60),
        3: (128, 160),
        4: (147, 240),
    }
    for strength, target in expected.items():
        assert t_way_coverage(rows, strength) == target

    print("selected_pairs=" + ",".join("x".join(p) for p in pairs))


if __name__ == "__main__":
    main()
