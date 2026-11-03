import { MagicStar } from 'iconsax-react-nativejs';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { CategoryBadge } from '@/components/badges';
import { Card, SectionLabel } from '@/components/ui/feedback';
import { Text } from '@/components/ui/Text';
import { CATEGORY_LABEL, errorLabel, formatCoords, SEVERITY_LABEL } from '@/lib/format';
import type { ReportDetail } from '@/lib/types';
import { colors } from '@/theme/tokens';

function CardHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <View className="flex-row items-end justify-between gap-3 px-4 pb-3 pt-4">
      <View className="flex-1 gap-1">
        <SectionLabel>{eyebrow}</SectionLabel>
        <Text className="font-bold text-[17px]">{title}</Text>
      </View>
      {action}
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-1 border-t border-line px-4 py-3">
      <Text className="text-[12.5px] text-ink-3">{label}</Text>
      {children}
    </View>
  );
}

export function AnalysisCard({ report }: { report: ReportDetail }) {
  const { analysis } = report;
  const result = analysis.result;
  return (
    <Card>
      <CardHeader
        eyebrow="Model interpretation"
        title="AI assessment"
        action={result ? <CategoryBadge category={report.hazard_category} /> : undefined}
      />
      {result ? (
        <>
          <View className="gap-3 px-4 pb-4">
            <Text className="text-[15px] leading-[22px]">{result.summary}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Severity" value={SEVERITY_LABEL[result.severity]} />
              <Chip label="Confidence" value={result.confidence} />
              <Chip label="Image" value={result.image_quality} />
            </View>
          </View>
          {result.observations.length > 0 && (
            <Row label="What it saw">
              {result.observations.map((o, i) => (
                <Text key={i} className="text-[14px] leading-5">
                  • {o.text}
                </Text>
              ))}
            </Row>
          )}
          {result.uncertainties.length > 0 && (
            <Row label="What it wasn't sure about">
              {result.uncertainties.map((u, i) => (
                <Text key={i} className="text-[14px] leading-5 text-ink-2">
                  • {u}
                </Text>
              ))}
            </Row>
          )}
          <View className="flex-row items-center gap-1.5 border-t border-line px-4 py-3">
            <MagicStar size={12} color={colors.ink[3]} />
            <Text className="text-[12px] text-ink-3">
              Muse Spark’s reading is a suggestion; a person reviews every report.
            </Text>
          </View>
        </>
      ) : analysis.status === 'pending' || analysis.status === 'running' ? (
        <View className="flex-row items-center gap-2.5 px-4 pb-4">
          <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
          <Text className="text-[14px] text-ink-2">Muse Spark is looking at your photo…</Text>
        </View>
      ) : (
        <Text className="px-4 pb-4 text-[14px] leading-5 text-ink-2">
          {analysis.status === 'unavailable'
            ? 'AI analysis is unavailable right now. A reviewer will read your report directly.'
            : `The analysis didn't finish (${errorLabel(analysis.error_code)}) A reviewer will read your report directly.`}
        </Text>
      )}
    </Card>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center gap-1 rounded-md border border-line bg-sunken px-2 py-1">
      <Text className="text-[12px] text-ink-3">{label}</Text>
      <Text className="font-semibold text-[12px] capitalize">{value}</Text>
    </View>
  );
}

export function ResidentFacts({ report }: { report: ReportDetail }) {
  return (
    <Card>
      <CardHeader eyebrow="Provided by you" title="What you reported" />
      <Row label="Type">
        <Text className="text-[14px]">
          {report.reporter_category
            ? CATEGORY_LABEL[report.reporter_category]
            : 'Not sure, left to the AI'}
        </Text>
      </Row>
      {report.description.trim() !== '' && (
        <Row label="Description">
          <Text className="text-[14px] leading-5">{report.description}</Text>
        </Row>
      )}
      {report.voice_transcript && (
        <Row label="Voice note">
          <Text className="text-[14px] leading-5">“{report.voice_transcript}”</Text>
        </Row>
      )}
      <Row label="Location">
        {report.location ? (
          <Text className="text-[14px]">
            {formatCoords(report.location.lat, report.location.lon)}
            {report.location_source === 'device_gps'
              ? ` · device location${report.location_accuracy_m ? ` (±${Math.round(report.location_accuracy_m)} m)` : ''}`
              : ' · pin placed on map'}
          </Text>
        ) : (
          <Text className="text-[14px] text-ink-3">Not shared</Text>
        )}
        {report.location_note && (
          <Text className="text-[13px] text-ink-3">{report.location_note}</Text>
        )}
      </Row>
    </Card>
  );
}
