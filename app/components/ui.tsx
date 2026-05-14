import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
type ButtonSize = 'sm' | 'md' | 'lg';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-none font-semibold tracking-[-0.01em] transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)] disabled:cursor-not-allowed disabled:border-[var(--tibo-border-quiet)] disabled:bg-[rgba(255,255,255,0.018)] disabled:text-zinc-700 disabled:opacity-70 disabled:hover:bg-[rgba(255,255,255,0.018)]';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'tibo-primary',
  secondary: 'tibo-secondary',
  ghost: 'bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
  danger: 'bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger-hover)]',
  icon: 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-primary)] hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-hover)]',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-10 px-4 text-xs',
  md: 'h-11 px-4 text-[15px]',
  lg: 'h-14 px-6 text-[15px]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx('tibo-input h-[var(--tibo-control-height)] rounded-none px-4 text-base', className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cx('tibo-input min-h-44 w-full resize-none rounded-none px-4 py-4 text-base', className)}
      {...props}
    />
  );
});

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('tibo-card rounded-none', className)}>{children}</div>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('tibo-label', className)}>{children}</p>;
}

export function ScientificNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('border-l border-zinc-800/80 pl-4 text-left', className)}>
      <p className="mb-1 font-tibo-mono text-[11px] uppercase tracking-[0.12em] text-zinc-600">BİLİMSEL NOT</p>
      <p className="text-[13px] leading-[1.4] text-zinc-500">{children}</p>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'danger' | 'primary';
  className?: string;
}) {
  return (
    <div className={cx('tibo-metric-card rounded-none px-4 py-4', className)}>
      <Label className="mb-4">{label}</Label>
      <p className={cx(
        'tibo-metric-value tibo-data text-2xl',
        tone === 'danger' ? 'text-[var(--color-danger)]' : tone === 'primary' ? 'text-[var(--color-primary)]' : 'text-white',
      )}>
        {value}
      </p>
      {hint && <p className="tibo-meta mt-2">{hint}</p>}
    </div>
  );
}

export function TimerDisplay({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('tibo-data text-[clamp(4.75rem,18vw,8rem)] font-bold leading-none transition-all duration-500 sm:text-[clamp(5.5rem,15vw,10rem)] lg:text-[clamp(6.75rem,12vw,18rem)]', className)}>
      {children}
    </p>
  );
}

export function SidebarItem({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      className={cx('block text-left text-[15px] text-zinc-500 transition-colors duration-150 hover:text-white', className)}
      {...props}
    >
      {children}
    </button>
  );
}
