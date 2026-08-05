import React, { type ReactNode } from "react";
import { Box, Button, Input, Text } from "@semos-labs/glyph";

export const COLORS = {
  accent: "#7AA2F7",
  muted: "#7F849C",
  panel: "#1E2030",
  field: "#24273A",
  success: "#A6DA95",
  warning: "#EED49F",
  error: "#ED8796",
} as const;

export function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline = false,
  autoFocus = false,
  height,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  height?: number;
}) {
  return (
    <Box style={{ gap: 0 }}>
      <Box style={{ flexDirection: "row", gap: 1 }}>
        <Text style={{ bold: true }}>{label}</Text>
        {hint ? <Text style={{ color: COLORS.muted }}>{hint}</Text> : null}
      </Box>
      <Input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        multiline={multiline}
        autoFocus={autoFocus}
        style={{ bg: COLORS.field, paddingX: 1, height }}
        focusedStyle={{ bg: "#363A4F", color: "white", paddingX: 1 }}
      />
    </Box>
  );
}

export function ActionButton({
  children,
  onPress,
  primary = false,
  disabled = false,
}: {
  children: ReactNode;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      onPress={onPress}
      disabled={disabled}
      style={{ paddingX: 2, bg: disabled ? COLORS.panel : primary ? COLORS.accent : COLORS.panel, color: disabled ? COLORS.muted : primary ? "black" : "white" }}
      focusedStyle={{ bg: "white", color: "black", bold: true }}
    >
      <Text>{children}</Text>
    </Button>
  );
}

export function StepActions({
  canGoBack,
  onBack,
  onNext,
  nextLabel = "Continue",
  disabled = false,
}: {
  canGoBack: boolean;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Box style={{ flexDirection: "row", gap: 1, paddingTop: 1 }}>
      {canGoBack ? <ActionButton onPress={onBack}>Back</ActionButton> : null}
      <ActionButton onPress={onNext} primary disabled={disabled}>{nextLabel}</ActionButton>
    </Box>
  );
}
