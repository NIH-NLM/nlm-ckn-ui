import Slider from "rc-slider";
import "rc-slider/assets/index.css";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import "./RangeSliderFilter.css";

/**
 * Dual-handle range slider with synchronized numeric inputs for filtering
 * edges by quantitative attributes (e.g., F-beta score, precision).
 */
const RangeSliderFilter = ({ field, min, max, currentMin, currentMax, onRangeChange }) => {
  const [localRange, setLocalRange] = useState([currentMin ?? min, currentMax ?? max]);
  const debounceRef = useRef(null);

  // Sync local state when props change (e.g., new graph loaded)
  useEffect(() => {
    setLocalRange([currentMin ?? min, currentMax ?? max]);
  }, [currentMin, currentMax, min, max]);

  const step = max > min ? (max - min) / 200 : 0.01;
  const precision = Math.max(0, Math.ceil(-Math.log10(step)));

  const dispatchChange = useCallback(
    (newMin, newMax) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onRangeChange(field, newMin, newMax);
      }, 200);
    },
    [field, onRangeChange],
  );

  const handleSliderChange = useCallback(
    (values) => {
      setLocalRange(values);
      dispatchChange(values[0], values[1]);
    },
    [dispatchChange],
  );

  const handleSliderComplete = useCallback(
    (values) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onRangeChange(field, values[0], values[1]);
    },
    [field, onRangeChange],
  );

  const handleInputChange = useCallback(
    (index, rawValue) => {
      const num = Number.parseFloat(rawValue);
      if (Number.isNaN(num)) return;
      const clamped = Math.min(Math.max(num, min), max);
      const next = [...localRange];
      next[index] = clamped;
      // Keep min <= max
      if (index === 0 && clamped > next[1]) next[1] = clamped;
      if (index === 1 && clamped < next[0]) next[0] = clamped;
      setLocalRange(next);
      dispatchChange(next[0], next[1]);
    },
    [min, max, localRange, dispatchChange],
  );

  return (
    <div className="range-slider-filter">
      <span className="range-slider-label">{field}</span>
      <Slider
        range
        min={min}
        max={max}
        step={step}
        value={localRange}
        onChange={handleSliderChange}
        onChangeComplete={handleSliderComplete}
        ariaLabelGroupForHandles={["Minimum", "Maximum"]}
      />
      <div className="range-slider-inputs">
        <input
          type="number"
          className="range-input"
          value={localRange[0].toFixed(precision)}
          min={min}
          max={max}
          step={step}
          onChange={(e) => handleInputChange(0, e.target.value)}
          aria-label={`${field} minimum`}
        />
        <span className="range-separator">–</span>
        <input
          type="number"
          className="range-input"
          value={localRange[1].toFixed(precision)}
          min={min}
          max={max}
          step={step}
          onChange={(e) => handleInputChange(1, e.target.value)}
          aria-label={`${field} maximum`}
        />
      </div>
    </div>
  );
};

export default memo(RangeSliderFilter);
