import { Fragment, type ReactNode } from "react";

export type Row = Record<string, unknown>;

export type Column = {
  readonly header: string;
  readonly render: (row: Row, index: number) => ReactNode;
  /** `"1%"` ciñe la columna a su contenido; sin ancho, la columna ocupa el resto. */
  readonly width?: string;
  /** Se oculta en pantallas estrechas (≤ 760 px). */
  readonly optional?: boolean;
};

type Message = { readonly title: string; readonly hint: string };

type Props = {
  readonly columns: readonly Column[];
  /** `null` = aún no se ha consultado; `[]` = la consulta no trajo filas. */
  readonly rows: readonly Row[] | null;
  readonly loading?: boolean;
  readonly idle: Message;
  readonly empty: Message;
  /** Hay más páginas en el backend (cursor); hoy solo se avisa. */
  readonly more?: boolean;
  /** Agrupa filas consecutivas bajo una fila de encabezado (p. ej. el día). */
  readonly groupBy?: (row: Row) => string;
  readonly onPick?: (row: Row) => void;
  readonly pickedId?: string;
  readonly pickLabel?: string;
};

function rowId(row: Row, index: number): string {
  return typeof row.id === "string" ? row.id : String(index);
}

function Notice({ title, hint }: Message) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}

function SkeletonRows({ columns }: { readonly columns: readonly Column[] }) {
  return (
    <>
      {["a", "b", "c", "d"].map((key) => (
        <tr key={key} className="skeleton-row">
          {columns.map((column) => (
            <td key={column.header} />
          ))}
        </tr>
      ))}
    </>
  );
}

/** Tablero de salidas: celdas de ancho fijo, encabezado pegajoso y filas por día. */
export function Board(props: Props) {
  const { columns, rows, loading } = props;
  if (!loading && rows === null) {
    return <Notice {...props.idle} />;
  }
  if (!loading && rows?.length === 0) {
    return <Notice {...props.empty} />;
  }
  return (
    <>
      <div className="board-scroll">
        <table className="board-table" aria-busy={loading}>
          <colgroup>
            {columns.map((column) => (
              <col
                key={column.header}
                className={column.optional ? "col-optional" : undefined}
                style={column.width ? { width: column.width } : undefined}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={column.optional ? "col-optional" : undefined}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows columns={columns} /> : null}
            {!loading && rows ? <BoardRows {...props} rows={rows} /> : null}
          </tbody>
        </table>
      </div>
      {!loading && rows ? (
        <p className="board-foot">
          {rows.length} {rows.length === 1 ? "fila" : "filas"}
          {props.more ? " · hay más páginas en el backend" : ""}
        </p>
      ) : null}
    </>
  );
}

function BoardRow({ row, index, ...props }: Props & { row: Row; index: number }) {
  const id = rowId(row, index);
  const picked = props.pickedId === id;
  return (
    <tr data-selected={picked} data-pickable={Boolean(props.onPick)}>
      {props.columns.map((column, col) => (
        <td key={column.header} className={column.optional ? "col-optional" : undefined}>
          {col === 0 && props.onPick ? (
            <button
              type="button"
              className="row-pick"
              onClick={() => props.onPick?.(row)}
              aria-pressed={picked}
              aria-label={props.pickLabel ? `${props.pickLabel} ${id}` : undefined}
            >
              {column.render(row, index)}
            </button>
          ) : (
            column.render(row, index)
          )}
        </td>
      ))}
    </tr>
  );
}

function BoardRows(props: Props & { rows: readonly Row[] }) {
  const { rows, groupBy, columns } = props;
  return (
    <>
      {rows.map((row, index) => {
        const group = groupBy?.(row);
        const prev = rows[index - 1];
        const opens = group !== undefined && (!prev || groupBy?.(prev) !== group);
        return (
          <Fragment key={rowId(row, index)}>
            {opens ? (
              <tr className="board-group">
                <th scope="colgroup" colSpan={columns.length}>
                  {group}
                </th>
              </tr>
            ) : null}
            <BoardRow {...props} row={row} index={index} />
          </Fragment>
        );
      })}
    </>
  );
}
