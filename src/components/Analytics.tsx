import { useState } from 'react';

export default function Analytics() {
  const [period, setPeriod] = useState('7d');

  const callLogs = [
    { id: 'C-1247', caller: 'John Smith', number: '+1 (555) 234-5678', time: '2024-01-15 10:30', duration: '3:24', status: 'resolved', intent: 'Appointment', satisfaction: 5 },
    { id: 'C-1246', caller: 'Sarah Johnson', number: '+1 (555) 345-6789', time: '2024-01-15 10:22', duration: '1:45', status: 'resolved', intent: 'Hours', satisfaction: 4 },
    { id: 'C-1245', caller: 'Mike Davis', number: '+1 (555) 456-7890', time: '2024-01-15 10:15', duration: '5:12', status: 'transferred', intent: 'Support', satisfaction: 3 },
    { id: 'C-1244', caller: 'Emily Chen', number: '+1 (555) 567-8901', time: '2024-01-15 09:58', duration: '2:30', status: 'resolved', intent: 'General', satisfaction: 5 },
    { id: 'C-1243', caller: 'Robert Wilson', number: '+1 (555) 678-9012', time: '2024-01-15 09:45', duration: '4:18', status: 'resolved', intent: 'Appointment', satisfaction: 4 },
    { id: 'C-1242', caller: 'Lisa Anderson', number: '+1 (555) 789-0123', time: '2024-01-15 09:30', duration: '1:55', status: 'escalated', intent: 'Complaint', satisfaction: 2 },
    { id: 'C-1241', caller: 'David Brown', number: '+1 (555) 890-1234', time: '2024-01-15 09:15', duration: '3:05', status: 'resolved', intent: 'Services', satisfaction: 5 },
    { id: 'C-1240', caller: 'Jennifer Lee', number: '+1 (555) 901-2345', time: '2024-01-15 09:00', duration: '2:48', status: 'resolved', intent: 'Hours', satisfaction: 4 },
  ];

  const hourlyData = [
    { hour: '8AM', calls: 12 }, { hour: '9AM', calls: 45 }, { hour: '10AM', calls: 67 },
    { hour: '11AM', calls: 54 }, { hour: '12PM', calls: 38 }, { hour: '1PM', calls: 42 },
    { hour: '2PM', calls: 58 }, { hour: '3PM', calls: 49 }, { hour: '4PM', calls: 36 },
    { hour: '5PM', calls: 28 }, { hour: '6PM', calls: 15 }, { hour: '7PM', calls: 8 },
  ];

  const maxCalls = Math.max(...hourlyData.map(d => d.calls));

  const weeklyData = [
    { day: 'Mon', calls: 234, resolved: 221 },
    { day: 'Tue', calls: 198, resolved: 187 },
    { day: 'Wed', calls: 256, resolved: 243 },
    { day: 'Thu', calls: 212, resolved: 198 },
    { day: 'Fri', calls: 189, resolved: 176 },
    { day: 'Sat', calls: 45, resolved: 43 },
    { day: 'Sun', calls: 23, resolved: 22 },
  ];

  const maxWeekly = Math.max(...weeklyData.map(d => d.calls));

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {[
            { id: '24h', label: '24 Hours' },
            { id: '7d', label: '7 Days' },
            { id: '30d', label: '30 Days' },
            { id: '90d', label: '90 Days' },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                period === p.id ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 transition-all flex items-center gap-2">
          <i className="fa-solid fa-download"></i>
          Export Report
        </button>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hourly Distribution */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <i className="fa-solid fa-chart-area text-violet-400"></i>
            Hourly Call Distribution
          </h3>
          <div className="flex items-end gap-2 h-40">
            {hourlyData.map((d, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-gray-400">{d.calls}</span>
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-violet-600 to-indigo-500 transition-all hover:from-violet-500 hover:to-indigo-400"
                  style={{ height: `${(d.calls / maxCalls) * 100}%` }}
                ></div>
                <span className="text-xs text-gray-500">{d.hour}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Weekly Overview */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <i className="fa-solid fa-chart-column text-violet-400"></i>
            Weekly Overview
          </h3>
          <div className="flex items-end gap-3 h-40">
            {weeklyData.map((d, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-gray-400">{d.calls}</span>
                <div className="w-full flex gap-0.5" style={{ height: `${(d.calls / maxWeekly) * 100}%` }}>
                  <div
                    className="flex-1 rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400"
                    style={{ height: `${(d.resolved / d.calls) * 100}%`, alignSelf: 'flex-end' }}
                  ></div>
                  <div
                    className="flex-1 rounded-t-md bg-gradient-to-t from-amber-600 to-amber-400"
                    style={{ height: `${((d.calls - d.resolved) / d.calls) * 100}%`, alignSelf: 'flex-start' }}
                  ></div>
                </div>
                <span className="text-xs text-gray-500">{d.day}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-emerald-500"></div>
              <span className="text-xs text-gray-400">Resolved</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-amber-500"></div>
              <span className="text-xs text-gray-400">Other</span>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Avg Handle Time', value: '2:47', icon: 'fa-stopwatch', trend: '-8%' },
          { label: 'Resolution Rate', value: '95.3%', icon: 'fa-check-circle', trend: '+2.1%' },
          { label: 'Customer CSAT', value: '4.6/5', icon: 'fa-star', trend: '+0.3' },
          { label: 'Abandonment Rate', value: '2.1%', icon: 'fa-phone-slash', trend: '-1.2%' },
        ].map((metric, idx) => (
          <div key={idx} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <i className={`fa-solid ${metric.icon} text-violet-400`}></i>
              <span className={`text-xs font-medium ${metric.trend.startsWith('+') ? 'text-emerald-400' : 'text-amber-400'}`}>
                {metric.trend}
              </span>
            </div>
            <p className="text-xl font-bold text-white">{metric.value}</p>
            <p className="text-xs text-gray-400 mt-1">{metric.label}</p>
          </div>
        ))}
      </div>

      {/* Call Logs Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="p-5 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-list text-violet-400"></i>
            Call Log
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search calls..."
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-violet-500 outline-none w-48"
            />
            <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-violet-500 outline-none">
              <option>All Status</option>
              <option>Resolved</option>
              <option>Transferred</option>
              <option>Escalated</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">ID</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Caller</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Time</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Duration</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Intent</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Rating</th>
              </tr>
            </thead>
            <tbody>
              {callLogs.map((log) => (
                <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-all">
                  <td className="px-5 py-3 text-xs font-mono text-gray-400">{log.id}</td>
                  <td className="px-5 py-3">
                    <p className="text-sm text-white">{log.caller}</p>
                    <p className="text-xs text-gray-500">{log.number}</p>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">{log.time}</td>
                  <td className="px-5 py-3 text-xs text-gray-300">{log.duration}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400">{log.intent}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      log.status === 'resolved' ? 'bg-emerald-500/10 text-emerald-400' :
                      log.status === 'transferred' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-red-500/10 text-red-400'
                    }`}>{log.status}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <i key={star} className={`fa-solid fa-star text-xs ${star <= log.satisfaction ? 'text-amber-400' : 'text-gray-700'}`}></i>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
