import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  tone?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ children, className = "", icon, tone = "primary", type = "button", ...props }: ButtonProps) {
  return (
    <button className={`button button--${tone} ${className}`.trim()} type={type} {...props}>
      {icon ? <Icon name={icon} size={17} /> : null}
      <span>{children}</span>
    </button>
  );
}

type FieldProps = {
  hint?: string;
  label: string;
  required?: boolean;
  children: ReactNode;
};

export function Field({ children, hint, label, required }: FieldProps) {
  return (
    <label className="field">
      <span className="field__label">
        {required ? <span className="field__required">*</span> : null}
        {label}
      </span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="control" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="control" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="control control--textarea" {...props} />;
}

type NoticeProps = {
  children: ReactNode;
  icon?: IconName;
  title?: string;
  tone?: "info" | "success" | "warning" | "danger";
};

export function Notice({ children, icon, title, tone = "info" }: NoticeProps) {
  const fallbackIcon: Record<NonNullable<NoticeProps["tone"]>, IconName> = {
    danger: "alert",
    info: "info",
    success: "check",
    warning: "alert",
  };

  return (
    <div className={`notice notice--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span className="notice__icon">
        <Icon name={icon ?? fallbackIcon[tone]} size={18} />
      </span>
      <div>
        {title ? <strong>{title}</strong> : null}
        <div className="notice__body">{children}</div>
      </div>
    </div>
  );
}

export function SectionHeading({ children, number, description }: { children: ReactNode; number?: number; description?: string }) {
  return (
    <div className="section-heading">
      {number ? <span className="section-heading__number">{number}</span> : null}
      <div>
        <h2>{children}</h2>
        {description ? <p>{description}</p> : null}
      </div>
    </div>
  );
}

export function EmptyLine() {
  return <span aria-hidden="true" className="document-line" />;
}
