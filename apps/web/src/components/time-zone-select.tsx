import type { SelectHTMLAttributes } from 'react';
import { Select } from '@/components/ui/form';

export function TimeZoneSelect({
  zones,
  allowEmpty,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { zones: string[]; allowEmpty?: string }) {
  return (
    <Select {...props}>
      {allowEmpty ? <option value="">{allowEmpty}</option> : null}
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, ' ')}
        </option>
      ))}
    </Select>
  );
}
