import { Children, forwardRef, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaCheck, FaChevronDown, FaSearch, FaTimes } from "react-icons/fa";

const EMPTY_POSITION = {
  top: 0,
  left: 0,
  width: 280,
  maxHeight: 320,
  placement: "bottom",
};

function nodeText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (typeof node === "object" && node.props?.children) return nodeText(node.props.children);
  return "";
}

function normalizeOption(option, groupLabel = "") {
  const value = option?.value ?? option?.key ?? option?.label ?? "";
  const label = option?.label ?? String(value);
  return {
    value: String(value),
    label: String(label),
    disabled: Boolean(option?.disabled),
    groupLabel,
    meta: option?.meta || option?.subtitle || option?.description || "",
    keywords: option?.keywords || option?.searchText || "",
  };
}

function optionsFromProp(options = []) {
  return options.flatMap((option) => {
    if (Array.isArray(option?.options)) {
      return option.options.map((child) => normalizeOption(child, option.label || option.groupLabel || ""));
    }
    return normalizeOption(option);
  });
}

function optionsFromChildren(children) {
  const parse = (child, groupLabel = "") => {
    if (!isValidElement(child)) return [];

    if (child.type === "optgroup") {
      return Children.toArray(child.props.children).flatMap((groupChild) => parse(groupChild, child.props.label || ""));
    }

    if (child.type !== "option") return [];

    const label = nodeText(child.props.children).trim();
    const value = child.props.value ?? label;
    return [
      {
        value: String(value ?? ""),
        label: label || String(value ?? ""),
        disabled: Boolean(child.props.disabled),
        groupLabel,
        meta: child.props["data-meta"] || child.props["data-subtitle"] || child.props["data-description"] || "",
        keywords: child.props["data-search"] || child.props["data-keywords"] || "",
      },
    ];
  };

  return Children.toArray(children).flatMap((child) => parse(child));
}

function buildChangeEvent(value, name) {
  const target = { name, value };
  return {
    target,
    currentTarget: target,
    type: "change",
    bubbles: true,
    cancelable: false,
    defaultPrevented: false,
    persist() {},
    preventDefault() {},
    stopPropagation() {},
  };
}

function buildBlurEvent(value, name) {
  const target = { name, value };
  return {
    target,
    currentTarget: target,
    type: "blur",
    bubbles: false,
    cancelable: false,
    defaultPrevented: false,
    persist() {},
    preventDefault() {},
    stopPropagation() {},
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const SearchableSelect = forwardRef(function SearchableSelect(
  {
    options,
    children,
    value,
    defaultValue = "",
    onChange,
    onValueChange,
    onBlur,
    name,
    id,
    className = "",
    popoverClassName = "",
    style,
    disabled = false,
    required = false,
    placeholder = "Select",
    searchPlaceholder = "Search...",
    emptyMessage = "No options found",
    "aria-label": ariaLabel,
    title,
    autoFocus,
    tabIndex,
    ...rest
  },
  ref
) {
  const generatedId = useId();
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const searchRef = useRef(null);
  const blurTimerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? ""));
  const [position, setPosition] = useState(EMPTY_POSITION);

  const isControlled = value !== undefined;
  const selectedValue = String(isControlled ? value ?? "" : internalValue ?? "");

  const normalizedOptions = useMemo(() => {
    const fromProps = Array.isArray(options) ? optionsFromProp(options) : [];
    return fromProps.length ? fromProps : optionsFromChildren(children);
  }, [children, options]);

  const selectedOption = useMemo(
    () => normalizedOptions.find((option) => option.value === selectedValue) || null,
    [normalizedOptions, selectedValue]
  );

  const filteredOptions = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return normalizedOptions;
    return normalizedOptions.filter((option) => {
      const haystack = `${option.label} ${option.value} ${option.meta} ${option.keywords}`.toLowerCase();
      return haystack.includes(cleanQuery);
    });
  }, [normalizedOptions, query]);

  const selectableOptions = useMemo(() => filteredOptions.filter((option) => !option.disabled), [filteredOptions]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const gutter = 10;
    const gap = 8;
    const minWidth = Math.min(240, viewportWidth - gutter * 2);
    const desiredWidth = Math.max(rect.width, minWidth);
    const width = Math.max(minWidth, Math.min(desiredWidth, viewportWidth - gutter * 2));
    const left = clamp(rect.left, gutter, viewportWidth - width - gutter);
    const roomBelow = viewportHeight - rect.bottom - gap - gutter;
    const roomAbove = rect.top - gap - gutter;
    const placement = roomBelow < 220 && roomAbove > roomBelow ? "top" : "bottom";
    const maxHeight = clamp(placement === "top" ? roomAbove : roomBelow, 160, Math.min(360, viewportHeight - gutter * 2));
    const top = placement === "top" ? Math.max(gutter, rect.top - gap - maxHeight) : rect.bottom + gap;
    setPosition({ top, left, width, maxHeight, placement });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const selectOption = useCallback(
    (option) => {
      if (!option || option.disabled) return;
      if (!isControlled) setInternalValue(option.value);
      onValueChange?.(option.value, option);
      onChange?.(buildChangeEvent(option.value, name));
      close();
      requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [close, isControlled, name, onChange, onValueChange]
  );

  useEffect(() => {
    if (!open) return undefined;

    updatePosition();
    const selectedIndex = selectableOptions.findIndex((option) => option.value === selectedValue);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);

    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    const handlePointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return;
      close();
    };
    const handleWindowMove = () => updatePosition();

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleWindowMove);
    window.addEventListener("scroll", handleWindowMove, true);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleWindowMove);
      window.removeEventListener("scroll", handleWindowMove, true);
    };
  }, [close, open, selectableOptions, selectedValue, updatePosition]);

  useEffect(() => {
    if (open) setActiveIndex((current) => clamp(current, 0, Math.max(selectableOptions.length - 1, 0)));
  }, [open, selectableOptions.length]);

  useEffect(() => {
    if (autoFocus) triggerRef.current?.focus();
  }, [autoFocus]);

  const displayLabel = selectedOption?.label || (selectedValue ? selectedValue : placeholder);
  const isPlaceholder = !selectedOption && !selectedValue;

  const buttonProps = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key.startsWith("data-") || key.startsWith("aria-"))
  );

  const handleTriggerKeyDown = (event) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => clamp(current + 1, 0, Math.max(selectableOptions.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => clamp(current - 1, 0, Math.max(selectableOptions.length - 1, 0)));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectOption(selectableOptions[activeIndex]);
    }
  };

  const handleBlur = () => {
    if (!onBlur) return;
    clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      if (popoverRef.current?.contains(document.activeElement)) return;
      onBlur(buildBlurEvent(selectedValue, name));
    }, 0);
  };

  const popover =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            className={`searchable-select-popover ${popoverClassName}`}
            style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
            data-placement={position.placement}
          >
            <div className="searchable-select-search">
              <FaSearch aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                aria-label="Search options"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                  <FaTimes aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="searchable-select-options" role="listbox" aria-labelledby={id || generatedId}>
              {filteredOptions.length ? (
                filteredOptions.map((option, index) => {
                  const selectableIndex = selectableOptions.findIndex((item) => item.value === option.value);
                  const isSelected = option.value === selectedValue;
                  const isActive = selectableIndex === activeIndex;
                  const showGroup =
                    option.groupLabel &&
                    (index === 0 || filteredOptions[index - 1]?.groupLabel !== option.groupLabel);

                  return (
                    <div key={`${option.groupLabel}-${option.value}-${index}`}>
                      {showGroup ? <div className="searchable-select-group">{option.groupLabel}</div> : null}
                      <button
                        type="button"
                        className={`searchable-select-option ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
                        disabled={option.disabled}
                        onMouseEnter={() => selectableIndex >= 0 && setActiveIndex(selectableIndex)}
                        onClick={() => selectOption(option)}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className="searchable-select-option__check" aria-hidden="true">
                          {isSelected ? <FaCheck /> : null}
                        </span>
                        <span className="searchable-select-option__text">
                          <span className="searchable-select-option__label">{option.label}</span>
                          {option.meta ? <span className="searchable-select-option__meta">{option.meta}</span> : null}
                        </span>
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="searchable-select-empty">{emptyMessage}</div>
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <span className={`searchable-select-root ${className.includes("w-full") || className.includes("flex-1") ? "is-fluid" : ""}`}>
        <button
          {...buttonProps}
          ref={triggerRef}
          type="button"
          id={id || generatedId}
          className={`searchable-select-trigger ${className}`}
          style={style}
          disabled={disabled}
          tabIndex={tabIndex}
          title={title || (typeof displayLabel === "string" ? displayLabel : undefined)}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-required={required || undefined}
          onClick={() => !disabled && setOpen((current) => !current)}
          onKeyDown={handleTriggerKeyDown}
          onBlur={handleBlur}
        >
          <span className={`searchable-select-value ${isPlaceholder ? "is-placeholder" : ""}`}>{displayLabel}</span>
          <FaChevronDown className={`searchable-select-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
        </button>
        {name ? (
          <input
            ref={ref}
            className="searchable-select-hidden-input"
            type="hidden"
            name={name}
            value={selectedValue}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
        ) : null}
      </span>
      {popover}
    </>
  );
});

export default SearchableSelect;
