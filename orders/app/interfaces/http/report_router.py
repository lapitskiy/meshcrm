from datetime import date as dt_date
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from psycopg import errors

from app.infrastructure.db.connection import get_connection
from app.interfaces.http.orders_router import (
    _fetch_accessible_warehouse_ids,
    _fetch_keycloak_user,
    _is_admin,
    _is_superadmin,
    _require_superadmin,
    _require_tenant_id,
    _require_user_uuid,
    _user_display_name_from_uuid,
    _user_lite_from_keycloak_payload,
)

router = APIRouter(prefix="/report", tags=["orders-report"])


class UserLiteOut(BaseModel):
    user_uuid: str
    username: str
    email: str
    full_name: str


class OrderReportIssueCreateIn(BaseModel):
    issue_kind: str = Field(min_length=1, max_length=50)
    reason: str = Field(min_length=1, max_length=4000)


class OrderReportIssueKindUpdateIn(BaseModel):
    issue_kind: str | None = Field(default=None, max_length=50)


class OrderReportCheckUpdateIn(BaseModel):
    checked: bool


class OrderReportIssueHistoryOut(BaseModel):
    id: UUID
    issue_kind: str
    reason: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: str


class OrderReportCommentCreateIn(BaseModel):
    comment: str = Field(min_length=1, max_length=4000)


class OrderReportCommentHistoryOut(BaseModel):
    id: UUID
    comment: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: str


class OrderReportLineIn(BaseModel):
    order_id: UUID
    order_number: int | None = None
    service_name: str = ""
    service_object_name: str = ""
    work_type_name: str = ""
    revenue: float = 0
    cost_price: float = 0
    comment: str = ""
    profit_percent: int = Field(default=0, ge=0, le=100)
    is_old_order: bool = False


class OrderReportCreateIn(BaseModel):
    report_date: dt_date
    warehouse_id: UUID
    warehouse_name: str = Field(min_length=1, max_length=255)
    day_rows: list[OrderReportLineIn] = Field(default_factory=list)
    old_money_rows: list[OrderReportLineIn] = Field(default_factory=list)
    minimum_salary: float = Field(default=1000, ge=0)
    salary_cash_from_change: float = Field(default=0, ge=0)
    salary_cash_from_revenue: float = Field(default=0, ge=0)


class OrderReportLineOut(BaseModel):
    id: UUID
    order_id: UUID
    order_number: int | None = None
    service_name: str = ""
    service_object_name: str = ""
    work_type_name: str = ""
    revenue: float = 0
    cost_price: float = 0
    comment: str = ""
    profit_percent: int = 0
    is_old_order: bool = False
    sort_order: int = 0


class OrderReportMissingOrderOut(BaseModel):
    order_id: UUID
    order_number: int | None = None


class OrderReportSummaryOut(BaseModel):
    id: UUID
    report_number: int
    report_date: str
    warehouse_id: UUID
    warehouse_name: str = ""
    total_revenue: float = 0
    total_master_salary: float = 0
    total_cash_remainder: float = 0
    minimum_salary: float = 0
    salary_cash_from_change: float = 0
    salary_cash_from_revenue: float = 0
    checked_by_admin_uuid: str | None = None
    checked_at: str | None = None
    created_by_uuid: str | None = None
    created_by_name: str = ""
    issue_kind: str | None = None
    created_at: str


class OrderReportDetailOut(OrderReportSummaryOut):
    lines: list[OrderReportLineOut] = Field(default_factory=list)
    day_orders_total_count: int = 0
    day_report_orders_count: int = 0
    missing_day_orders: list[OrderReportMissingOrderOut] = Field(default_factory=list)


class OrderReportListOut(BaseModel):
    items: list[OrderReportSummaryOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class OrderReportProblemReminderOut(BaseModel):
    report_id: UUID
    report_number: int
    report_date: str
    warehouse_id: UUID
    warehouse_name: str = ""
    created_by_uuid: str | None = None
    created_by_name: str = ""
    problem_since: str
    days_overdue: int = 0


def _report_totals(lines: list[OrderReportLineIn]) -> tuple[float, float, float]:
    revenue = 0.0
    master_salary = 0.0
    cash_remainder = 0.0
    for line in lines:
        line_revenue = float(line.revenue or 0)
        line_cost = float(line.cost_price or 0)
        line_profit = line_revenue - line_cost
        line_master_salary = max(0.0, line_profit * (int(line.profit_percent or 0) / 100.0))
        revenue += line_revenue
        master_salary += line_master_salary
        cash_remainder += line_revenue - line_master_salary
    return revenue, master_salary, cash_remainder


def _report_summary_from_row(row) -> OrderReportSummaryOut:
    return OrderReportSummaryOut(
        id=row[0],
        report_number=int(row[1] or 0),
        report_date=row[2].isoformat(),
        warehouse_id=row[3],
        warehouse_name=str(row[4] or "").strip(),
        total_revenue=float(row[5] or 0),
        total_master_salary=float(row[6] or 0),
        total_cash_remainder=float(row[7] or 0),
        minimum_salary=float(row[8] or 0),
        salary_cash_from_change=float(row[9] or 0),
        salary_cash_from_revenue=float(row[10] or 0),
        checked_by_admin_uuid=row[11],
        checked_at=row[12].isoformat() if row[12] else None,
        created_by_uuid=row[13],
        created_by_name=_user_display_name_from_uuid(row[13]),
        issue_kind=str(row[14] or "").strip() or None,
        created_at=row[15].isoformat(),
    )


def _ensure_report_access(cur, request: Request, report_id: UUID) -> None:
    tenant_id = _require_tenant_id(request)
    params: list = [report_id, tenant_id]
    where_parts = ["r.id = %s", "r.tenant_id = %s"]
    if not _is_superadmin(request):
        accessible_warehouse_ids = _fetch_accessible_warehouse_ids(request)
        if not accessible_warehouse_ids:
            raise HTTPException(status_code=404, detail="report not found or unavailable")
        where_parts.append("r.warehouse_id = ANY(%s::uuid[])")
        params.append(accessible_warehouse_ids)
    cur.execute(
        f"""
        SELECT 1
        FROM order_reports r
        WHERE {' AND '.join(where_parts)}
        LIMIT 1
        """,
        tuple(params),
    )
    if cur.fetchone() is None:
        raise HTTPException(status_code=404, detail="report not found or unavailable")


def _report_day_order_coverage(cur, tenant_id: str, report_date, warehouse_id, lines: list[OrderReportLineOut]):
    included_order_ids = {line.order_id for line in lines if not line.is_old_order}
    cur.execute(
        """
        SELECT id, order_number
        FROM orders
        WHERE warehouse_id = %s
          AND tenant_id = %s
          AND created_at::date = %s
        ORDER BY order_number ASC NULLS LAST, created_at ASC
        """,
        (warehouse_id, tenant_id, report_date),
    )
    day_orders = cur.fetchall()
    missing_orders = [
        OrderReportMissingOrderOut(order_id=row[0], order_number=row[1])
        for row in day_orders
        if row[0] not in included_order_ids
    ]
    return len(day_orders), len(included_order_ids), missing_orders


@router.post("/reports", response_model=OrderReportDetailOut, status_code=201)
def create_order_report(payload: OrderReportCreateIn, request: Request) -> OrderReportDetailOut:
    conn = None
    try:
        if not _is_superadmin(request):
            accessible_warehouse_ids = _fetch_accessible_warehouse_ids(request)
            if str(payload.warehouse_id) not in {str(x) for x in accessible_warehouse_ids}:
                raise HTTPException(status_code=403, detail="forbidden for selected warehouse")
        tenant_id = _require_tenant_id(request)
        created_by_uuid = _require_user_uuid(request)
        all_lines = list(payload.day_rows or []) + list(payload.old_money_rows or [])
        total_revenue, total_master_salary, total_cash_remainder = _report_totals(all_lines)
        minimum_salary = float(payload.minimum_salary or 0)
        salary_cash_from_change = float(payload.salary_cash_from_change or 0)
        salary_cash_from_revenue = float(payload.salary_cash_from_revenue or 0)
        if salary_cash_from_revenue > total_revenue:
            raise HTTPException(
                status_code=400,
                detail="Нельзя взять из выручки на зарплату больше суммы текущей выручки.",
            )
        total_master_salary += salary_cash_from_revenue
        minimum_salary_delta = max(0.0, minimum_salary - total_master_salary)
        total_master_salary += minimum_salary_delta
        if salary_cash_from_change + salary_cash_from_revenue > total_master_salary:
            raise HTTPException(
                status_code=400,
                detail="Сумма из размена и из выручки на зарплату не может быть больше суммы зарплаты.",
            )
        total_cash_remainder += salary_cash_from_change
        total_cash_remainder -= salary_cash_from_revenue
        total_cash_remainder -= minimum_salary_delta
        report_id = uuid4()
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT report_number
                FROM order_reports
                WHERE report_date = %s
                  AND tenant_id = %s
                  AND warehouse_id = %s
                  AND created_by_uuid = %s
                LIMIT 1
                """,
                (payload.report_date, tenant_id, payload.warehouse_id, created_by_uuid),
            )
            existing_report = cur.fetchone()
            if existing_report is not None:
                raise HTTPException(
                    status_code=409,
                    detail=f"Отчёт за эту дату и склад уже создан: №{int(existing_report[0] or 0)}",
                )
            cur.execute(
                """
                INSERT INTO order_reports (
                  tenant_id,
                  id, report_date, warehouse_id, warehouse_name,
                  total_revenue, total_master_salary, total_cash_remainder,
                  minimum_salary, salary_cash_from_change, salary_cash_from_revenue, created_by_uuid
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING
                  id, report_number, report_date, warehouse_id, warehouse_name,
                  total_revenue, total_master_salary, total_cash_remainder,
                  minimum_salary, salary_cash_from_change, salary_cash_from_revenue,
                  checked_by_admin_uuid, checked_at,
                  created_by_uuid, issue_kind, created_at
                """,
                (
                    tenant_id,
                    report_id,
                    payload.report_date,
                    payload.warehouse_id,
                    payload.warehouse_name.strip(),
                    total_revenue,
                    total_master_salary,
                    total_cash_remainder,
                    minimum_salary,
                    salary_cash_from_change,
                    salary_cash_from_revenue,
                    created_by_uuid,
                ),
            )
            header_row = cur.fetchone()
            out_lines: list[OrderReportLineOut] = []
            all_payload_lines = [
                *(payload.day_rows or []),
                *(payload.old_money_rows or []),
            ]
            for index, line in enumerate(all_payload_lines):
                cur.execute(
                    """
                    INSERT INTO order_report_lines (
                      tenant_id,
                      id, report_id, order_id, order_number,
                      service_name, service_object_name, work_type_name,
                      revenue, cost_price, comment, profit_percent,
                      is_old_order, sort_order
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING
                      id, order_id, order_number, service_name, service_object_name, work_type_name,
                      revenue, cost_price, comment, profit_percent, is_old_order, sort_order
                    """,
                    (
                        tenant_id,
                        uuid4(),
                        report_id,
                        line.order_id,
                        line.order_number,
                        line.service_name.strip(),
                        line.service_object_name.strip(),
                        line.work_type_name.strip(),
                        float(line.revenue or 0),
                        float(line.cost_price or 0),
                        line.comment.strip(),
                        int(line.profit_percent or 0),
                        bool(line.is_old_order),
                        index,
                    ),
                )
                row = cur.fetchone()
                out_lines.append(
                    OrderReportLineOut(
                        id=row[0],
                        order_id=row[1],
                        order_number=row[2],
                        service_name=str(row[3] or "").strip(),
                        service_object_name=str(row[4] or "").strip(),
                        work_type_name=str(row[5] or "").strip(),
                        revenue=float(row[6] or 0),
                        cost_price=float(row[7] or 0),
                        comment=str(row[8] or "").strip(),
                        profit_percent=int(row[9] or 0),
                        is_old_order=bool(row[10]),
                        sort_order=int(row[11] or 0),
                    )
                )
            day_total, day_in_report, missing_orders = _report_day_order_coverage(
                cur, tenant_id, payload.report_date, payload.warehouse_id, out_lines
            )
        summary = _report_summary_from_row(header_row)
        conn.commit()
        return OrderReportDetailOut(
            **summary.model_dump(),
            lines=out_lines,
            day_orders_total_count=day_total,
            day_report_orders_count=day_in_report,
            missing_day_orders=missing_orders,
        )
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except errors.UniqueViolation as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=409, detail="Отчёт за эту дату и склад уже создан") from exc
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/reports", response_model=OrderReportListOut)
def list_order_reports(
    request: Request,
    page: int = 1,
    page_size: int = 20,
    report_date: str | None = Query(default=None),
    warehouse_id: UUID | None = Query(default=None),
    created_by_uuid: str | None = Query(default=None),
    checked: bool | None = Query(default=None),
) -> OrderReportListOut:
    conn = None
    try:
        safe_page = max(1, int(page))
        safe_page_size = max(1, min(int(page_size), 100))
        offset = (safe_page - 1) * safe_page_size
        tenant_id = _require_tenant_id(request)
        where_parts: list[str] = ["r.tenant_id = %s"]
        params: list = [tenant_id]
        if not _is_superadmin(request):
            accessible_warehouse_ids = _fetch_accessible_warehouse_ids(request)
            if not accessible_warehouse_ids:
                return OrderReportListOut(items=[], total=0, page=safe_page, page_size=safe_page_size, total_pages=1)
            where_parts.append("r.warehouse_id = ANY(%s::uuid[])")
            params.append(accessible_warehouse_ids)
        if report_date and str(report_date).strip():
            try:
                dt_date.fromisoformat(str(report_date).strip())
            except Exception as exc:
                raise HTTPException(status_code=400, detail="report_date must be YYYY-MM-DD") from exc
            where_parts.append("r.report_date = %s")
            params.append(str(report_date).strip())
        if warehouse_id:
            where_parts.append("r.warehouse_id = %s")
            params.append(warehouse_id)
        if created_by_uuid and str(created_by_uuid).strip():
            _require_superadmin(request)
            where_parts.append("r.created_by_uuid = %s")
            params.append(str(created_by_uuid).strip())
        if checked is not None:
            where_parts.append("r.checked_at IS NOT NULL" if checked else "r.checked_at IS NULL")
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM order_reports r {where_sql}", tuple(params))
            total = int(cur.fetchone()[0] or 0)
            cur.execute(
                """
                SELECT
                  r.id, r.report_number, r.report_date, r.warehouse_id, r.warehouse_name,
                  r.total_revenue, r.total_master_salary, r.total_cash_remainder,
                  r.minimum_salary, r.salary_cash_from_change, r.salary_cash_from_revenue,
                  r.checked_by_admin_uuid, r.checked_at,
                  r.created_by_uuid, r.issue_kind, r.created_at
                FROM order_reports r
                """
                + where_sql
                + """
                ORDER BY r.created_at DESC, r.report_number DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [safe_page_size, offset]),
            )
            rows = cur.fetchall()
        items = [_report_summary_from_row(row) for row in rows]
        total_pages = (total + safe_page_size - 1) // safe_page_size if total else 1
        return OrderReportListOut(
            items=items,
            total=total,
            page=safe_page,
            page_size=safe_page_size,
            total_pages=total_pages,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/reports/{report_id}", response_model=OrderReportDetailOut)
def get_order_report(report_id: UUID, request: Request) -> OrderReportDetailOut:
    conn = None
    try:
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_report_access(cur, request, report_id)
            cur.execute(
                """
                SELECT
                  r.id, r.report_number, r.report_date, r.warehouse_id, r.warehouse_name,
                  r.total_revenue, r.total_master_salary, r.total_cash_remainder,
                  r.minimum_salary, r.salary_cash_from_change, r.salary_cash_from_revenue,
                  r.checked_by_admin_uuid, r.checked_at,
                  r.created_by_uuid, r.issue_kind, r.created_at
                FROM order_reports r
                WHERE r.id = %s AND r.tenant_id = %s
                LIMIT 1
                """,
                (report_id, tenant_id),
            )
            header_row = cur.fetchone()
            if header_row is None:
                raise HTTPException(status_code=404, detail="report not found")
            cur.execute(
                """
                SELECT
                  id, order_id, order_number, service_name, service_object_name, work_type_name,
                  revenue, cost_price, comment, profit_percent, is_old_order, sort_order
                FROM order_report_lines
                WHERE report_id = %s AND tenant_id = %s
                ORDER BY is_old_order ASC, sort_order ASC, order_number ASC NULLS LAST
                """,
                (report_id, tenant_id),
            )
            line_rows = cur.fetchall()
            lines = [
                OrderReportLineOut(
                    id=row[0],
                    order_id=row[1],
                    order_number=row[2],
                    service_name=str(row[3] or "").strip(),
                    service_object_name=str(row[4] or "").strip(),
                    work_type_name=str(row[5] or "").strip(),
                    revenue=float(row[6] or 0),
                    cost_price=float(row[7] or 0),
                    comment=str(row[8] or "").strip(),
                    profit_percent=int(row[9] or 0),
                    is_old_order=bool(row[10]),
                    sort_order=int(row[11] or 0),
                )
                for row in line_rows
            ]
            day_total, day_in_report, missing_orders = _report_day_order_coverage(cur, tenant_id, header_row[2], header_row[3], lines)
        summary = _report_summary_from_row(header_row)
        return OrderReportDetailOut(
            **summary.model_dump(),
            lines=lines,
            day_orders_total_count=day_total,
            day_report_orders_count=day_in_report,
            missing_day_orders=missing_orders,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/creators/options", response_model=list[UserLiteOut])
def list_report_creator_options(request: Request, q: str | None = None) -> list[UserLiteOut]:
    _require_superadmin(request)
    conn = None
    try:
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT created_by_uuid
                FROM order_reports
                WHERE tenant_id = %s
                  AND created_by_uuid IS NOT NULL
                  AND created_by_uuid <> ''
                ORDER BY created_by_uuid
                """,
                (tenant_id,),
            )
            rows = cur.fetchall()
        term = str(q or "").strip().lower()
        out: list[UserLiteOut] = []
        for row in rows:
            user_uuid = str(row[0] or "").strip()
            if not user_uuid:
                continue
            try:
                payload = _fetch_keycloak_user(user_uuid)
            except Exception:
                continue
            item = _user_lite_from_keycloak_payload(user_uuid, payload)
            haystack = f"{item.full_name} {item.username} {item.email}".lower()
            if term and term not in haystack:
                continue
            out.append(
                UserLiteOut(
                    user_uuid=item.user_uuid,
                    username=item.username,
                    email=item.email,
                    full_name=item.full_name,
                )
            )
        out.sort(key=lambda item: (item.full_name.lower(), item.email.lower(), item.username.lower()))
        return out[:50]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/problem-reminders", response_model=list[OrderReportProblemReminderOut])
def list_problem_report_reminders(request: Request, limit: int = 20) -> list[OrderReportProblemReminderOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 1000))
        tenant_id = _require_tenant_id(request)
        where_parts = ["r.tenant_id = %s", "r.issue_kind = 'problem'"]
        params: list = [tenant_id]
        if not _is_superadmin(request):
            accessible_warehouse_ids = _fetch_accessible_warehouse_ids(request)
            if not accessible_warehouse_ids:
                return []
            where_parts.append("r.warehouse_id = ANY(%s::uuid[])")
            params.append(accessible_warehouse_ids)
        where_sql = f"WHERE {' AND '.join(where_parts)}"
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  r.id, r.report_number, r.report_date, r.warehouse_id, r.warehouse_name,
                  r.created_by_uuid, COALESCE(MAX(h.created_at), r.created_at) AS problem_since,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(MAX(h.created_at), r.created_at))) / 86400)::int)
                FROM order_reports r
                LEFT JOIN order_report_issue_history h ON h.report_id = r.id AND h.tenant_id = r.tenant_id
                """
                + where_sql
                + """
                GROUP BY r.id, r.report_number, r.report_date, r.warehouse_id, r.warehouse_name, r.created_by_uuid, r.created_at
                ORDER BY problem_since ASC, r.report_number ASC
                LIMIT %s
                """,
                tuple(params + [safe_limit]),
            )
            rows = cur.fetchall()
        return [
            OrderReportProblemReminderOut(
                report_id=row[0],
                report_number=int(row[1] or 0),
                report_date=row[2].isoformat(),
                warehouse_id=row[3],
                warehouse_name=str(row[4] or "").strip(),
                created_by_uuid=row[5],
                created_by_name=_user_display_name_from_uuid(row[5]),
                problem_since=row[6].isoformat(),
                days_overdue=int(row[7] or 0),
            )
            for row in rows
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("/reports/{report_id}/issues", response_model=OrderReportIssueHistoryOut, status_code=201)
def create_order_report_issue(
    report_id: UUID, payload: OrderReportIssueCreateIn, request: Request
) -> OrderReportIssueHistoryOut:
    conn = None
    try:
        reason = payload.reason.strip()
        issue_kind = str(payload.issue_kind or "").strip().lower()
        if issue_kind != "problem":
            raise HTTPException(status_code=400, detail="only problem issue_kind is supported")
        if not reason:
            raise HTTPException(status_code=400, detail="reason must not be empty")
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_report_access(cur, request, report_id)
            cur.execute("UPDATE order_reports SET issue_kind = %s WHERE id = %s AND tenant_id = %s", (issue_kind, report_id, tenant_id))
            cur.execute(
                """
                INSERT INTO order_report_issue_history (tenant_id, id, report_id, issue_kind, reason, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, issue_kind, reason, created_by_uuid, created_at
                """,
                (tenant_id, uuid4(), report_id, issue_kind, reason, user_uuid),
            )
            row = cur.fetchone()
        conn.commit()
        return OrderReportIssueHistoryOut(
            id=row[0],
            issue_kind=str(row[1] or "").strip(),
            reason=str(row[2] or "").strip(),
            created_by_uuid=row[3],
            created_by_name=_user_display_name_from_uuid(row[3]),
            created_at=row[4].isoformat(),
        )
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/reports/{report_id}/issues", response_model=list[OrderReportIssueHistoryOut])
def list_order_report_issues(report_id: UUID, request: Request, limit: int = 100) -> list[OrderReportIssueHistoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 500))
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_report_access(cur, request, report_id)
            cur.execute(
                """
                SELECT id, issue_kind, reason, created_by_uuid, created_at
                FROM order_report_issue_history
                WHERE report_id = %s AND tenant_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (report_id, tenant_id, safe_limit),
            )
            rows = cur.fetchall()
        return [
            OrderReportIssueHistoryOut(
                id=row[0],
                issue_kind=str(row[1] or "").strip(),
                reason=str(row[2] or "").strip(),
                created_by_uuid=row[3],
                created_by_name=_user_display_name_from_uuid(row[3]),
                created_at=row[4].isoformat(),
            )
            for row in rows
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/reports/{report_id}/issue-kind", response_model=OrderReportSummaryOut)
def update_order_report_issue_kind(
    report_id: UUID, payload: OrderReportIssueKindUpdateIn, request: Request
) -> OrderReportSummaryOut:
    conn = None
    try:
        next_issue_kind = str(payload.issue_kind or "").strip().lower() or None
        if next_issue_kind not in {None, "problem"}:
            raise HTTPException(status_code=400, detail="only problem issue_kind is supported")
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_report_access(cur, request, report_id)
            cur.execute("SELECT issue_kind FROM order_reports WHERE id = %s AND tenant_id = %s", (report_id, tenant_id))
            current = cur.fetchone()
            if current is None:
                raise HTTPException(status_code=404, detail="report not found")
            current_issue_kind = str(current[0] or "").strip().lower() or None
            if current_issue_kind == "problem" and next_issue_kind is None and not _is_admin(request):
                raise HTTPException(status_code=403, detail="forbidden: admin role required")
            cur.execute(
                """
                UPDATE order_reports
                SET issue_kind = %s
                WHERE id = %s AND tenant_id = %s
                RETURNING
                  id, report_number, report_date, warehouse_id, warehouse_name,
                  total_revenue, total_master_salary, total_cash_remainder,
                  minimum_salary, salary_cash_from_change, salary_cash_from_revenue,
                  checked_by_admin_uuid, checked_at,
                  created_by_uuid, issue_kind, created_at
                """,
                (next_issue_kind, report_id, tenant_id),
            )
            row = cur.fetchone()
        conn.commit()
        return _report_summary_from_row(row)
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/reports/{report_id}/check", response_model=OrderReportSummaryOut)
def update_order_report_check(
    report_id: UUID, payload: OrderReportCheckUpdateIn, request: Request
) -> OrderReportSummaryOut:
    if not _is_admin(request):
        raise HTTPException(status_code=403, detail="forbidden: admin role required")
    conn = None
    try:
        admin_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_report_access(cur, request, report_id)
            cur.execute(
                """
                UPDATE order_reports
                SET checked_by_admin_uuid = CASE WHEN %s THEN %s ELSE NULL END,
                    checked_at = CASE WHEN %s THEN now() ELSE NULL END
                WHERE id = %s AND tenant_id = %s
                RETURNING
                  id, report_number, report_date, warehouse_id, warehouse_name,
                  total_revenue, total_master_salary, total_cash_remainder,
                  minimum_salary, salary_cash_from_change, salary_cash_from_revenue,
                  checked_by_admin_uuid, checked_at,
                  created_by_uuid, issue_kind, created_at
                """,
                (payload.checked, admin_uuid, payload.checked, report_id, tenant_id),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="report not found")
        conn.commit()
        return _report_summary_from_row(row)
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.delete("/reports/{report_id}", status_code=204)
def delete_order_report(report_id: UUID, request: Request) -> None:
    if not _is_admin(request):
        raise HTTPException(status_code=403, detail="forbidden: admin role required")
    conn = None
    try:
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_report_access(cur, request, report_id)
            cur.execute("DELETE FROM order_reports WHERE id = %s AND tenant_id = %s", (report_id, tenant_id))
            if cur.rowcount < 1:
                raise HTTPException(status_code=404, detail="report not found")
        conn.commit()
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("/reports/{report_id}/comments", response_model=OrderReportCommentHistoryOut, status_code=201)
def create_order_report_comment(
    report_id: UUID, payload: OrderReportCommentCreateIn, request: Request
) -> OrderReportCommentHistoryOut:
    conn = None
    try:
        comment = payload.comment.strip()
        if not comment:
            raise HTTPException(status_code=400, detail="comment must not be empty")
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_report_access(cur, request, report_id)
            cur.execute(
                """
                INSERT INTO order_report_comment_history (tenant_id, id, report_id, comment, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, comment, created_by_uuid, created_at
                """,
                (tenant_id, uuid4(), report_id, comment, user_uuid),
            )
            row = cur.fetchone()
        conn.commit()
        return OrderReportCommentHistoryOut(
            id=row[0],
            comment=str(row[1] or "").strip(),
            created_by_uuid=row[2],
            created_by_name=_user_display_name_from_uuid(row[2]),
            created_at=row[3].isoformat(),
        )
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/reports/{report_id}/comments", response_model=list[OrderReportCommentHistoryOut])
def list_order_report_comments(
    report_id: UUID, request: Request, limit: int = 100
) -> list[OrderReportCommentHistoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 500))
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_report_access(cur, request, report_id)
            cur.execute(
                """
                SELECT id, comment, created_by_uuid, created_at
                FROM order_report_comment_history
                WHERE report_id = %s AND tenant_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (report_id, tenant_id, safe_limit),
            )
            rows = cur.fetchall()
        return [
            OrderReportCommentHistoryOut(
                id=row[0],
                comment=str(row[1] or "").strip(),
                created_by_uuid=row[2],
                created_by_name=_user_display_name_from_uuid(row[2]),
                created_at=row[3].isoformat(),
            )
            for row in rows
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()
