import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { motion } from 'motion/react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

// Framer's motion.button defines its own gesture/animation handlers, so drop the DOM
// versions that would otherwise clash with the typed props.
interface ButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'onAnimationStart' | 'onAnimationEnd' | 'onDrag' | 'onDragStart' | 'onDragEnd'
  > {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
  'duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-40 ' +
  'disabled:pointer-events-none select-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg hover:brightness-105 shadow-sm shadow-accent/20 hover:shadow-md hover:shadow-accent/25',
  secondary:
    'bg-surface-raised text-ink border border-line-strong hover:border-accent/60 hover:text-accent hover:shadow-sm hover:shadow-black/5',
  ghost: 'text-ink-soft hover:text-ink hover:bg-ink/5',
  danger:
    'bg-transparent text-negative border border-negative/40 hover:bg-negative/10 hover:shadow-sm hover:shadow-negative/10',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.96 }}
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 600, damping: 28 }}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    />
  );
});
