import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../pages/cashier/Icon";

const defaultGetItems = (response) => response?.data || [];
const defaultGetKey = (item) => item?.id || item?.customerId || item?.guestId || item?.email || item?.name;
const defaultGetLabel = (item) => item?.customerName || item?.guestName || item?.name || "";
const defaultGetSecondary = (item) =>
  [item?.customerEmail || item?.guestEmail || item?.email, item?.customerPhone || item?.guestPhone || item?.phone]
    .filter(Boolean)
    .join(" · ");

export function LookupSearch({
  value,
  onInputChange,
  onSearch,
  onSelect,
  placeholder = "Search...",
  minChars = 2,
  limit = 12,
  disabled = false,
  autoFocus = false,
  inputRef,
  className = "",
  inputClassName = "",
  dropdownClassName = "",
  getItems = defaultGetItems,
  getKey = defaultGetKey,
  getLabel = defaultGetLabel,
  getSecondary = defaultGetSecondary,
  renderItem,
  minCharsText,
  emptyText = "No matching records found.",
  loadingText = "Searching...",
}) {
  const [innerValue, setInnerValue] = useState(value || "");
  const [items, setItems] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const closeTimerRef = useRef(null);
  const selectedLabelRef = useRef("");

  const query = value ?? innerValue;
  const trimmed = query.trim();
  const resolvedMinText =
    minCharsText || `Type at least ${minChars} characters to search.`;

  useEffect(() => {
    if (value !== undefined) {
      setInnerValue(value || "");
    }
  }, [value]);

  useEffect(() => {
    const selectedLabel = selectedLabelRef.current.trim();
    if (!trimmed || trimmed.length < minChars || (selectedLabel && trimmed === selectedLabel)) {
      requestIdRef.current += 1;
      setItems([]);
      setIsLoading(false);
      setError("");
      setIsOpen(false);
      return undefined;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError("");
      setIsOpen(true);
      try {
        const response = await onSearch(trimmed, { limit });
        if (requestIdRef.current !== requestId) return;
        setItems(getItems(response));
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setItems([]);
        setError(err?.data?.message || err?.message || "Search failed.");
      } finally {
        if (requestIdRef.current === requestId) setIsLoading(false);
      }
    }, 240);

    return () => clearTimeout(timer);
  }, [trimmed, minChars, limit, onSearch, getItems]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const showDropdown = isOpen && trimmed.length >= minChars;

  const body = useMemo(() => {
    if (isLoading) {
      return <div className="lookup-search__state">{loadingText}</div>;
    }
    if (error) {
      return <div className="lookup-search__state lookup-search__state--error">{error}</div>;
    }
    if (!items.length) {
      return <div className="lookup-search__state">{emptyText}</div>;
    }

    return items.map((item) => {
      const key = getKey(item);
      return (
        <button
          key={key}
          type="button"
          className="lookup-search__option"
          onClick={() => {
            const label = getLabel(item);
            selectedLabelRef.current = label || "";
            onSelect?.(item);
            setInnerValue(label);
            setItems([]);
            setIsLoading(false);
            setError("");
            setIsOpen(false);
          }}
        >
          {renderItem ? (
            renderItem(item)
          ) : (
            <>
              <span className="lookup-search__avatar">
                {(getLabel(item) || "?").trim().slice(0, 1).toUpperCase()}
              </span>
              <span className="lookup-search__text">
                <span className="lookup-search__primary">{getLabel(item) || "Untitled"}</span>
                <span className="lookup-search__secondary">{getSecondary(item) || "No contact on file"}</span>
              </span>
            </>
          )}
        </button>
      );
    });
  }, [emptyText, error, getKey, getLabel, getSecondary, isLoading, items, loadingText, onSelect, renderItem]);

  return (
    <div className={`lookup-search ${className}`.trim()}>
      <div className={`lookup-search__control ${inputClassName}`.trim()}>
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          disabled={disabled}
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            selectedLabelRef.current = "";
            setInnerValue(next);
            onInputChange?.(next);
          }}
          onFocus={() => {
            const selectedLabel = selectedLabelRef.current.trim();
            if (trimmed.length >= minChars && trimmed !== selectedLabel && items.length) {
              setIsOpen(true);
            }
          }}
          onBlur={() => {
            closeTimerRef.current = setTimeout(() => setIsOpen(false), 120);
          }}
          placeholder={placeholder}
          className="lookup-search__input"
        />
        {query ? (
          <button
            type="button"
            className="lookup-search__clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              selectedLabelRef.current = "";
              setInnerValue("");
              setItems([]);
              setIsOpen(false);
              onInputChange?.("");
            }}
            aria-label="Clear search"
          >
            <Icon name="x" size={15} />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <div
          className={`lookup-search__menu ${dropdownClassName}`.trim()}
          onMouseDown={(event) => {
            event.preventDefault();
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          }}
        >
          {body}
        </div>
      ) : trimmed && trimmed.length < minChars ? (
        <div className="lookup-search__hint">{resolvedMinText}</div>
      ) : null}
    </div>
  );
}
