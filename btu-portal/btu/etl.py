"""Turns raw monday items into scoreboard events, applying and logging every correction.

Every Event keeps the monday item it came from. Every correction (duplicate removed, repeat
excluded, program routed, record dropped) is recorded as a Correction or an Issue naming the
items behind it, so any number on the portal can be traced back to the raw rows.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from . import rules
from .values import Item, date_of, norm_name, number_of, text_of


# --- Inputs ---------------------------------------------------------------------------------

@dataclass
class BoardData:
    meta: dict                      # id, name, items_count, groups[], columns[]
    items: list[dict]
    pulled_at: str | None = None
    error: str | None = None        # last refresh error for this board, if any


@dataclass
class Dataset:
    boards: dict[str, BoardData]
    run_id: int | None = None
    refreshed_at: str | None = None
    demo: bool = False


# --- Outputs --------------------------------------------------------------------------------

@dataclass
class ItemRef:
    board_id: str
    item_id: str
    name: str
    detail: str = ""


@dataclass
class Issue:
    kind: str
    severity: str                   # error | warning | info
    message: str
    items: list[ItemRef] = field(default_factory=list)


@dataclass
class Correction:
    rule: str
    board_id: str
    item_id: str
    name: str
    detail: str


@dataclass
class Event:
    board_key: str
    board_id: str
    item_id: str
    name: str
    stage: str
    program: str
    program_basis: str
    date: date
    utility: str | None = None
    source: str | None = None
    engineer: str | None = None
    group_title: str | None = None
    incentive: float | None = None
    share: float | None = None
    energy: float | None = None
    utility_is_type: bool = False
    duplicate_of: str | None = None
    dup_group_size: int = 1
    repeat_of: str | None = None
    repeat_first_date: date | None = None
    counted: bool = True

    @property
    def month(self) -> str:
        return rules.month_of(self.date)

    def dollars(self, mode: str) -> float | None:
        return self.incentive if mode == "incentive" else self.share

    @property
    def status_label(self) -> str:
        if self.duplicate_of:
            return f"Duplicate of #{self.duplicate_of}"
        if self.repeat_of:
            first = self.repeat_first_date.isoformat() if self.repeat_first_date else "?"
            return f"Repeat of #{self.repeat_of} (first logged {first})" + (
                "" if not self.counted else " — counted (policy)")
        return "Counted"


@dataclass
class Model:
    events: list[Event]
    corrections: list[Correction]
    issues: list[Issue]
    columns: dict[str, dict[str, dict]]        # board key -> logical name -> resolution
    unavailable: dict[tuple[str, str], str]    # (stage, program or "*") -> reason
    dollars_unavailable: dict[tuple[str, str, str], str]  # (stage, program|*, mode) -> reason
    dataset: Dataset
    by_stage_month: dict[tuple[str, str], list[Event]] = field(default_factory=dict)

    def unavailable_reason(self, stage: str, program: str) -> str | None:
        return self.unavailable.get((stage, program)) or self.unavailable.get((stage, "*"))

    def dollars_reason(self, stage: str, program: str, mode: str) -> str | None:
        return (self.dollars_unavailable.get((stage, program, mode))
                or self.dollars_unavailable.get((stage, "*", mode)))

    def events_for(self, stage: str, month: str) -> list[Event]:
        return self.by_stage_month.get((stage, month), [])


# --- Column resolution ----------------------------------------------------------------------

def resolve_columns(spec: dict, board: BoardData, board_key: str, issues: list[Issue]) -> dict:
    """Map logical column names to ids on this board. Id wins; blank id -> exact title match."""
    cols = board.meta.get("columns") or []
    by_id = {c["id"]: c for c in cols}
    by_title = defaultdict(list)
    for c in cols:
        by_title[(c.get("title") or "").strip().lower()].append(c)
    out = {}
    for logical, s in spec.items():
        s = s if isinstance(s, dict) else {"id": s}
        cid, title = (s.get("id") or "").strip(), (s.get("title") or "").strip()
        res = {"logical": logical, "configured_id": cid, "title": title, "id": None, "how": None}
        if cid and cid in by_id:
            res.update(id=cid, how="id", found_title=by_id[cid].get("title"))
        elif cid:
            matches = by_title.get(title.lower(), []) if title else []
            if len(matches) == 1:
                res.update(id=matches[0]["id"], how="title (configured id missing)")
                issues.append(Issue("column_resolved_by_title", "warning",
                                    f"{board_key}: column id {cid!r} for {logical} is not on the board; "
                                    f"resolved by title {title!r} to {matches[0]['id']!r}. Pin that id."))
            else:
                res["how"] = "missing"
                issues.append(Issue("column_missing", "error",
                                    f"{board_key}: column {cid!r} ({logical}) is not on the board."))
        elif title:
            matches = by_title.get(title.lower(), [])
            if len(matches) == 1:
                res.update(id=matches[0]["id"], how="title")
                issues.append(Issue("column_resolved_by_title", "info",
                                    f"{board_key}: {logical} resolved by title {title!r} to id "
                                    f"{matches[0]['id']!r}. Pin the id in config.toml."))
            else:
                res["how"] = "ambiguous" if matches else "missing"
                issues.append(Issue("column_missing", "error" if logical != "program" else "info",
                                    f"{board_key}: no unique column titled {title!r} for {logical} "
                                    f"({len(matches)} matches). Set its id in config.toml."))
        else:
            res["how"] = "not configured"
        out[logical] = res
    return out


def _cid(cols: dict, logical: str) -> str | None:
    r = cols.get(logical)
    return r["id"] if r else None


def _ref(board: BoardData, it: Item, detail: str = "") -> ItemRef:
    return ItemRef(str(board.meta.get("id", "")), it.id, it.name, detail)


# --- KPI board ------------------------------------------------------------------------------

def build_kpi_events(cfg, ds: Dataset, model: Model) -> None:
    board = ds.boards.get("kpi")
    kpi_stages = [s for s in cfg["kpi"]["stage_groups"].values()]
    if board is None or board.meta is None:
        for s in kpi_stages:
            model.unavailable[(s, "*")] = "Monthly KPIs board has not been pulled from monday."
        return
    cols = resolve_columns(cfg["kpi"]["columns"], board, "kpi", model.issues)
    model.columns["kpi"] = cols
    if not _cid(cols, "date"):
        for s in kpi_stages:
            model.unavailable[(s, "*")] = "Completion Date column not found on the KPI board."
        return
    for mode, logical in (("incentive", "incentive"), ("share", "share")):
        if not _cid(cols, logical):
            for s in kpi_stages:
                model.dollars_unavailable[(s, "*", mode)] = f"{logical} column not found on the KPI board."

    groups = cfg["kpi"]["stage_groups"]
    bptu_board = ds.boards.get("bptu")
    bptu_names = ({rules.base_name(i.get("name", "")) for i in bptu_board.items}
                  if bptu_board is not None else None)
    bptu_full = ({norm_name(i.get("name", "")) for i in bptu_board.items}
                 if bptu_board is not None else None)

    unmapped_groups: dict[str, list[ItemRef]] = defaultdict(list)
    missing_date, blank_util, unknown_util, bad_numbers = [], [], [], []
    type_util, phase_board, phase_col = [], [], []

    for raw in board.items:
        it = Item(raw)
        stage = groups.get(it.group_id)
        if stage is None:
            unmapped_groups[f"{it.group_id} ({it.group_title})"].append(_ref(board, it))
            continue
        d = date_of(it, _cid(cols, "date"))
        if d is None:
            missing_date.append(_ref(board, it, f"stage {stage}"))
            continue
        utility = text_of(it, _cid(cols, "utility"))
        program_col = text_of(it, _cid(cols, "program"))
        pr = rules.map_program(utility, it.name, program_col)
        vals = {}
        for logical in ("incentive", "share", "energy"):
            v, problem = number_of(it, _cid(cols, logical))
            if problem:
                bad_numbers.append(_ref(board, it, f"{logical}: {problem}"))
            vals[logical] = v
        ev = Event("kpi", str(board.meta.get("id")), it.id, it.name, stage, pr.program, pr.basis, d,
                   utility=utility, source=text_of(it, _cid(cols, "source")),
                   engineer=text_of(it, _cid(cols, "engineer")), group_title=it.group_title,
                   utility_is_type=pr.utility_is_type, **vals)
        model.events.append(ev)

        if pr.blank:
            blank_util.append(_ref(board, it, f"{stage} {d}"))
        if pr.unknown:
            unknown_util.append(_ref(board, it, f"Utility {utility!r}"))
        if pr.utility_is_type:
            type_util.append(_ref(board, it, f"Utility {utility!r}"))
        if pr.program in ("BGE Tune-Up", "BPTU"):
            model.corrections.append(Correction("program_split", ev.board_id, it.id, it.name, pr.basis))
        if pr.name_rule and program_col and pr.program != pr.name_rule:
            phase_col.append(_ref(board, it, f"Program column says {pr.program}; name rule says {pr.name_rule}"))
        if pr.name_rule and bptu_names is not None:
            on_board = norm_name(it.name) in bptu_full or rules.base_name(it.name) in bptu_names
            if pr.name_rule == "BPTU" and not on_board:
                phase_board.append(_ref(board, it, "Name has a Phase tag (→ BPTU) but no matching project on the BPTU tracker"))
            elif pr.name_rule == "BGE Tune-Up" and on_board:
                phase_board.append(_ref(board, it, "No Phase tag (→ BGE Tune-Up) but this building is on the BPTU tracker"))

    I = model.issues
    for g, refs in unmapped_groups.items():
        I.append(Issue("unmapped_group", "error",
                       f"{len(refs)} KPI items sit in group {g}, which is not mapped to a stage. "
                       f"Groups are matched by id only; add the id under [kpi.stage_groups] if it is a stage.",
                       refs))
    if missing_date:
        I.append(Issue("missing_date", "error",
                       f"{len(missing_date)} KPI items have no Completion Date and cannot be placed in any "
                       f"week. Creation/update logs are never used as a substitute.", missing_date))
    if blank_util:
        I.append(Issue("blank_utility", "warning",
                       f"{len(blank_util)} records have a blank Utility; shown in the Unmapped row.", blank_util))
    if unknown_util:
        I.append(Issue("unknown_utility", "warning",
                       f"{len(unknown_util)} records have a Utility value with no program mapping; shown "
                       f"in the Unmapped row.", unknown_util))
    if bad_numbers:
        I.append(Issue("unparseable_number", "warning",
                       f"{len(bad_numbers)} numeric values could not be read and are left empty.", bad_numbers))
    if type_util:
        I.append(Issue("utility_is_type", "info",
                       f"{len(type_util)} records carry a project type (HVAC BTU / HVAC BPTU / HVAC Tune Up) "
                       f"in the Utility field and were routed to Prescriptive. They have no real utility, so "
                       f"they are absent from every utility's totals.", type_util))
    if bptu_names is None:
        I.append(Issue("phase_check_unavailable", "warning",
                       "Phase-rule check skipped: the BGE BPTU Tracker has not been pulled."))
    # One issue per record so each disagreement can be read and drilled on its own.
    for r in phase_board + phase_col:
        I.append(Issue("phase_rule_disagreement", "warning", r.detail, [r]))


# --- Project trackers: Implementations Completed --------------------------------------------

def build_impl_events(cfg, ds: Dataset, model: Model, today: date) -> None:
    stage = "impl_completed"
    for tkey, t in cfg.get("trackers", {}).items():
        fixed = t.get("program") or ""
        affected = [fixed] if fixed else [p for p in rules.ALL_ROWS if p not in ("BPTU", "Prescriptive")]
        board = ds.boards.get(t["board"])
        label = f"{tkey} tracker"

        def unavailable(reason):
            for p in affected:
                model.unavailable[(stage, p)] = reason

        if board is None:
            unavailable(f"{label} has not been pulled from monday.")
            continue
        cols = resolve_columns(t["columns"], board, tkey, model.issues)
        model.columns[tkey] = cols
        if not _cid(cols, "impl_date"):
            unavailable(f"{label}: implementation date column not found.")
            continue
        closeout_groups = set(t.get("closeout_group_ids") or [])
        if not _cid(cols, "status") and not closeout_groups:
            unavailable(f"{label}: no status column and no closeout groups configured, so completion "
                        f"cannot be confirmed (a past date alone is not enough).")
            continue
        if not fixed and not _cid(cols, "utility"):
            unavailable(f"{label}: utility column not resolved, so the program cannot be determined.")
            continue
        for mode in ("incentive", "share"):
            if not _cid(cols, mode):
                for p in affected:
                    model.dollars_unavailable[(stage, p, mode)] = f"{label}: {mode} column not found."
        done_statuses = {s.strip().lower() for s in t.get("complete_statuses", [])}
        past_not_done = []
        for raw in board.items:
            it = Item(raw)
            d = date_of(it, _cid(cols, "impl_date"))
            if d is None or d > today:
                continue
            status = text_of(it, _cid(cols, "status"))
            done = (status or "").strip().lower() in done_statuses or it.group_id in closeout_groups
            if not done:
                past_not_done.append(_ref(board, it, f"{d} · status {status!r} · group {it.group_title!r}"))
                continue
            if fixed:
                program, basis, utility, is_type = fixed, f"On the {tkey} tracker", None, False
            else:
                utility = text_of(it, _cid(cols, "utility"))
                pr = rules.map_program(utility, it.name)
                program, basis, is_type = pr.program, pr.basis + f" (from {tkey} tracker)", pr.utility_is_type
            inc, _ = number_of(it, _cid(cols, "incentive"))
            shr, _ = number_of(it, _cid(cols, "share"))
            model.events.append(Event(tkey, str(board.meta.get("id")), it.id, it.name, stage, program,
                                      basis, d, utility=utility, group_title=it.group_title,
                                      incentive=inc, share=shr, utility_is_type=is_type,
                                      source=f"status {status!r}" if status else f"group {it.group_title!r}"))
        if past_not_done:
            model.issues.append(Issue(
                "impl_past_not_complete", "warning",
                f"{label}: {len(past_not_done)} items have a past implementation date but the tracker "
                f"does not show the work done. Not counted as complete.", past_not_done))


# --- Duplicates and repeats -----------------------------------------------------------------

def apply_dedup(model: Model) -> None:
    groups: dict[tuple, list[Event]] = defaultdict(list)
    for e in model.events:
        if e.board_key == "kpi":
            groups[(e.date, norm_name(e.name), e.stage, e.program)].append(e)
    conflicts = []
    for (d, _, stage, program), evs in groups.items():
        if len(evs) < 2:
            continue
        evs.sort(key=lambda e: (len(e.item_id), e.item_id))
        canon = evs[0]
        for e in evs:
            e.dup_group_size = len(evs)
        for e in evs[1:]:
            e.duplicate_of = canon.item_id
            e.counted = False
            model.corrections.append(Correction(
                "duplicate", e.board_id, e.item_id, e.name,
                f"Same date {d}, project, stage {stage} and program {program} as #{canon.item_id}; "
                f"counted once."))
            if (e.incentive, e.share) != (canon.incentive, canon.share):
                conflicts.append(ItemRef(e.board_id, e.item_id, e.name,
                                         f"duplicate of #{canon.item_id}: incentive {e.incentive} vs "
                                         f"{canon.incentive}, share {e.share} vs {canon.share}; the first "
                                         f"item's values are used"))
    if conflicts:
        model.issues.append(Issue("duplicate_value_conflict", "warning",
                                  f"{len(conflicts)} duplicates carry different dollar values from the "
                                  f"item they duplicate.", conflicts))


def apply_repeats(cfg, model: Model) -> None:
    count_as_new = bool(cfg["rules"].get("count_repeats_as_new", False))
    stages = set(cfg["rules"].get("repeat_stages", ["pa_submitted", "co_submitted"]))
    canon = sorted((e for e in model.events if e.stage in stages and not e.duplicate_of),
                   key=lambda e: (e.date, len(e.item_id), e.item_id))
    first: dict[tuple, Event] = {}
    for e in canon:
        if e.incentive is None:
            continue
        k = (e.stage, norm_name(e.name), e.program, round(e.incentive, 2))
        prior = first.get(k)
        if prior is None:
            first[k] = e
        elif prior.date < e.date:
            e.repeat_of, e.repeat_first_date = prior.item_id, prior.date
            e.counted = count_as_new
            model.corrections.append(Correction(
                "repeat", e.board_id, e.item_id, e.name,
                f"Same project, program and incentive ${e.incentive:,.0f} as #{prior.item_id} first "
                f"logged {prior.date}; " + ("counted (count_repeats_as_new = true)." if count_as_new
                                            else "not counted as new work.")))


# --- Entry point ----------------------------------------------------------------------------

def compute(cfg: dict, ds: Dataset, today: date) -> Model:
    model = Model([], [], [], {}, {}, {}, ds)
    for key, b in ds.boards.items():
        if b.error:
            model.issues.append(Issue("refresh_error", "error",
                                      f"Last refresh of {key} failed: {b.error}. Figures from this board "
                                      f"are from the previous successful pull ({b.pulled_at or 'never'})."))
    build_kpi_events(cfg, ds, model)
    build_impl_events(cfg, ds, model, today)
    apply_dedup(model)
    apply_repeats(cfg, model)
    idx: dict[tuple[str, str], list[Event]] = defaultdict(list)
    for e in model.events:
        idx[(e.stage, e.month)].append(e)
    model.by_stage_month = dict(idx)
    return model
