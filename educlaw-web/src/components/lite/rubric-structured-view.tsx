import type { ReactNode } from 'react';

import { MarkdownContent } from './lite-rendering';
import {
  parseRubricPresentation,
  type RubricPresentation,
} from './rubric-presentation';

function InfoPill({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

function HeaderMeta({ parsed }: { parsed: RubricPresentation }) {
  const items: string[] = [];
  if (parsed.dimensionCount > 0) {
    items.push(`${parsed.dimensionCount} 个评分维度`);
  }
  if (parsed.weighted) {
    items.push('含权重');
  }
  if (!items.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <InfoPill key={item}>{item}</InfoPill>
      ))}
    </div>
  );
}

function WeightTag({ value }: { value: string }) {
  return <InfoPill>{`权重 ${value}`}</InfoPill>;
}

function SectionSurface({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[16px] border border-border/70 bg-card/90 ${className}`.trim()}
    >
      {children}
    </div>
  );
}

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function StructuredTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<{ cells: string[] }>;
}) {
  return (
    <SectionSurface>
      <TableShell>
        <thead className="bg-muted/55">
          <tr>
            {columns.map((column, index) => (
              <th
                key={`${column}-${index}`}
                className={`px-3 py-3 text-left text-xs font-semibold text-foreground ${
                  index > 0 ? 'border-l border-border/60' : ''
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={`${row.cells[0] || 'row'}-${rowIndex}`}
              className="align-top border-t border-border/60 even:bg-muted/20"
            >
              {columns.map((column, cellIndex) => {
                const value = row.cells[cellIndex] || '-';
                const isWeightColumn = /权重/.test(column);
                const isFirstColumn = cellIndex === 0;

                return (
                  <td
                    key={`${row.cells[0] || 'cell'}-${cellIndex}`}
                    className={`px-3 py-3 leading-6 text-foreground ${
                      cellIndex > 0 ? 'border-l border-border/60' : ''
                    }`}
                  >
                    {isWeightColumn && value !== '-' ? (
                      <WeightTag value={value} />
                    ) : isFirstColumn ? (
                      <span className="font-medium text-foreground">
                        {value}
                      </span>
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </TableShell>
    </SectionSurface>
  );
}

function ScoreBandSections({
  dimensions,
}: {
  dimensions: Array<{
    title: string;
    weight?: string;
    bands: Array<{ label: string; reason: string }>;
  }>;
}) {
  return (
    <div className="space-y-4">
      {dimensions.map((dimension, index) => (
        <SectionSurface key={`${dimension.title}-${index}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/35 px-4 py-3">
            <div className="text-sm font-semibold text-foreground">
              {dimension.title}
            </div>
            {dimension.weight && <WeightTag value={dimension.weight} />}
          </div>
          <TableShell>
            <thead className="bg-background/80">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">
                  等级
                </th>
                <th className="border-l border-border/60 px-4 py-3 text-left text-xs font-semibold text-foreground">
                  评分理由
                </th>
              </tr>
            </thead>
            <tbody>
              {dimension.bands.map((band) => (
                <tr
                  key={`${dimension.title}-${band.label}`}
                  className="align-top border-t border-border/60 even:bg-muted/20"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {band.label}
                  </td>
                  <td className="border-l border-border/60 px-4 py-3 leading-6 text-foreground">
                    {band.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </SectionSurface>
      ))}
    </div>
  );
}

function CriteriaTable({
  rows,
}: {
  rows: Array<{ title: string; weight?: string; reason: string }>;
}) {
  const showWeight = rows.some((row) => Boolean(row.weight));

  return (
    <SectionSurface>
      <TableShell>
        <thead className="bg-muted/55">
          <tr>
            <th className="px-3 py-3 text-left text-xs font-semibold text-foreground">
              维度
            </th>
            {showWeight && (
              <th className="border-l border-border/60 px-3 py-3 text-left text-xs font-semibold text-foreground">
                权重
              </th>
            )}
            <th className="border-l border-border/60 px-3 py-3 text-left text-xs font-semibold text-foreground">
              评分要点
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.title}-${index}`}
              className="align-top border-t border-border/60 even:bg-muted/20"
            >
              <td className="px-3 py-3 font-medium text-foreground">
                {row.title}
              </td>
              {showWeight && (
                <td className="border-l border-border/60 px-3 py-3 text-foreground">
                  {row.weight ? <WeightTag value={row.weight} /> : '-'}
                </td>
              )}
              <td className="border-l border-border/60 px-3 py-3 leading-6 text-foreground">
                {row.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </SectionSurface>
  );
}

function ParagraphSections({
  paragraphs,
}: {
  paragraphs: Array<{ heading: string; weight?: string; body: string }>;
}) {
  return (
    <div className="space-y-4">
      {paragraphs.map((para, index) => (
        <SectionSurface key={`${para.heading}-${index}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/35 px-4 py-3">
            <div className="text-sm font-semibold text-foreground">
              {para.heading}
            </div>
            {para.weight && <WeightTag value={para.weight} />}
          </div>
          <div className="px-4 py-4">
            <MarkdownContent content={para.body} />
          </div>
        </SectionSurface>
      ))}
    </div>
  );
}

export function RubricStructuredView({ content }: { content: string }) {
  const parsed = parseRubricPresentation(content);
  const showTitle = Boolean(parsed.title && parsed.title !== 'Rubric');

  return (
    <div className="space-y-4">
      {(showTitle || parsed.dimensionCount > 0 || parsed.weighted) && (
        <SectionSurface>
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
            {showTitle ? (
              <div className="text-sm font-semibold text-foreground">
                {parsed.title}
              </div>
            ) : (
              <div />
            )}
            <HeaderMeta parsed={parsed} />
          </div>
        </SectionSurface>
      )}

      {parsed.kind === 'level-table' ? (
        <StructuredTable columns={parsed.columns} rows={parsed.rows} />
      ) : parsed.kind === 'score-band' ? (
        <ScoreBandSections dimensions={parsed.dimensions} />
      ) : parsed.kind === 'criteria' ? (
        <CriteriaTable rows={parsed.rows} />
      ) : parsed.kind === 'paragraph' ? (
        <ParagraphSections paragraphs={parsed.paragraphs} />
      ) : (
        <SectionSurface className="px-4 py-4">
          <MarkdownContent content={parsed.raw} />
        </SectionSurface>
      )}
    </div>
  );
}
