import * as React from 'react';
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { children?: React.ReactNode; }
export function Select(props: SelectProps): JSX.Element;
