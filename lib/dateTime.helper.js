import moment from 'moment-timezone';

/**
 * Checks if a current time is within a specified time range (HH:mm format).
 * Handles ranges that cross midnight (e.g., 22:00 to 05:00).
 * 
 * @param {Date} now - Current time
 * @param {string} start - Start time range (HH:mm)
 * @param {string} end - End time range (HH:mm)
 * @returns {boolean}
 */
export const isWithinTimeRange = (now, start, end) => {
  const currentTime = moment(now).tz('Asia/Ho_Chi_Minh');
  const [startHour, startMin] = start.split(':').map(Number);
  const [endHour, endMin] = end.split(':').map(Number);

  const startTime = moment(currentTime).set({ hour: startHour, minute: startMin, second: 0 });
  let endTime = moment(currentTime).set({ hour: endHour, minute: endMin, second: 0 });

  if (endHour < startHour || (endHour === startHour && endMin < startMin)) {
    // If end time is earlier than start time, it means the range crosses midnight
    if (currentTime.isBefore(startTime)) {
        // If current time is before start (meaning it's early morning of the next day of the range)
        startTime.subtract(1, 'day');
    } else {
        // Current time is late night
        endTime.add(1, 'day');
    }
  }

  return currentTime.isBetween(startTime, endTime, null, '[]');
};

/**
 * Checks if a specific day is a holiday based on a list.
 * 
 * @param {Date} now - Current date
 * @param {Array} holidays - List of HolidayConfig objects
 * @returns {Object|null} The holiday object if found
 */
export const getActiveHoliday = (now, holidays = []) => {
  const currentStr = moment(now).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  return holidays.find(h => {
    const startStr = moment(h.startDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
    const endStr = moment(h.endDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
    return currentStr >= startStr && currentStr <= endStr && h.isActive;
  });
};

