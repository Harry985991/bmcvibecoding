import React, { useState, useEffect } from 'react';
import { Upload, Search, Filter, Plus, Edit2, Trash2, Download, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function JobMasterTracker() {
  const [jobs, setJobs] = useState([]);
  const [filteredJobs, setFilteredJobs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDept, setFilterDept] = useState('全部');
  const [filterStatus, setFilterStatus] = useState('全部');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingJob, setEditingJob] = useState(null);

  // 載入儲存的資料
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const result = await window.storage.get('job-master-data');
      if (result && result.value) {
        const data = JSON.parse(result.value);
        setJobs(data);
        setFilteredJobs(data);
      }
    } catch (error) {
      console.log('首次使用，尚無資料');
    }
  };

  const saveData = async (data) => {
    try {
      await window.storage.set('job-master-data', JSON.stringify(data));
    } catch (error) {
      console.error('儲存失敗:', error);
      alert('資料儲存失敗，請稍後再試');
    }
  };

  // 篩選功能
  useEffect(() => {
    let filtered = jobs;
    
    if (searchTerm) {
      filtered = filtered.filter(job => 
        job.jobId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.department?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.position?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.jobFamily?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (filterDept !== '全部') {
      filtered = filtered.filter(job => job.department === filterDept);
    }
    
    if (filterStatus !== '全部') {
      filtered = filtered.filter(job => job.status === filterStatus);
    }
    
    setFilteredJobs(filtered);
  }, [searchTerm, filterDept, filterStatus, jobs]);

  // 上傳Excel
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet);

        const newJobs = jsonData.map((row, index) => {
          const dept = row['HC所屬部門'] || row['部門'] || row['用人單位'] || '';
          return {
            id: Date.now() + index,
            jobId: generateJobId(dept, jobs.length + index + 1),
            department: dept,
            position: row['職務名稱'] || row['職位名稱'] || row['職缺名稱'] || '',
            location: row['工作地點'] || '',
            jobFamily: row['職系'] || '',
            headcount: row['需求人數'] || 1,
            approver: row['核准人'] || '',
            approvalDate: row['核准日期'] || '',
            salaryRange: row['薪資範圍'] || row['預算職等'] || '',
            reason: row['需求原因'] || row['備註'] || '',
            status: row['職缺狀態'] || '開啟中',
            uploadDate: new Date().toLocaleDateString('zh-TW')
          };
        });

        const updatedJobs = [...jobs, ...newJobs];
        setJobs(updatedJobs);
        await saveData(updatedJobs);
        alert(`成功匯入 ${newJobs.length} 筆職缺資料`);
      } catch (error) {
        console.error('檔案解析錯誤:', error);
        alert('檔案格式錯誤，請確認Excel格式正確');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // 生成Job ID
  const generateJobId = (dept, count) => {
    const deptCode = dept.substring(0, 3).toUpperCase();
    const year = new Date().getFullYear();
    const num = String(count).padStart(3, '0');
    return `${deptCode}-${year}-${num}`;
  };

  // 新增職缺
  const handleAddJob = async (jobData) => {
    const newJob = {
      ...jobData,
      id: Date.now(),
      jobId: generateJobId(jobData.department, jobs.length + 1),
      uploadDate: new Date().toLocaleDateString('zh-TW')
    };
    const updatedJobs = [...jobs, newJob];
    setJobs(updatedJobs);
    await saveData(updatedJobs);
    setShowAddModal(false);
  };

  // 編輯職缺
  const handleEditJob = async (jobData) => {
    const updatedJobs = jobs.map(job => 
      job.id === editingJob.id ? { ...job, ...jobData } : job
    );
    setJobs(updatedJobs);
    await saveData(updatedJobs);
    setEditingJob(null);
  };

  // 刪除職缺
  const handleDeleteJob = async (id) => {
    if (confirm('確定要刪除此職缺嗎？')) {
      const updatedJobs = jobs.filter(job => job.id !== id);
      setJobs(updatedJobs);
      await saveData(updatedJobs);
    }
  };

  // 匯出Excel
  const handleExport = () => {
    const exportData = filteredJobs.map(job => ({
      '職缺代碼': job.jobId,
      'HC所屬部門': job.department,
      '職務名稱': job.position,
      '工作地點': job.location,
      '職系': job.jobFamily,
      '需求人數': job.headcount,
      '核准人': job.approver,
      '核准日期': job.approvalDate,
      '薪資範圍': job.salaryRange,
      '需求原因': job.reason,
      '職缺狀態': job.status,
      '建檔日期': job.uploadDate
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Job Master');
    XLSX.writeFile(wb, `Job_Master_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const departments = ['全部', ...new Set(jobs.map(j => j.department).filter(Boolean))];
  const statuses = ['全部', '開啟中', '招募中', '關閉'];

  // 計算總需求人數
  const totalHeadcount = jobs.reduce((sum, job) => sum + (Number(job.headcount) || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-indigo-900">BMC Recruitment Tracker</h1>
              <p className="text-sm text-gray-600 mt-1">Job Master - 職缺主檔管理系統</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">最後更新</p>
              <p className="text-sm font-semibold text-gray-700">{new Date().toLocaleString('zh-TW')}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* 工具列 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 上傳檔案 */}
            <label className="flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer transition-colors">
              <Upload size={20} />
              <span className="font-medium">上傳 Excel</span>
              <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
            </label>

            {/* 新增職缺 */}
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Plus size={20} />
              <span className="font-medium">新增職缺</span>
            </button>

            {/* 匯出Excel */}
            <button
              onClick={handleExport}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              disabled={filteredJobs.length === 0}
            >
              <Download size={20} />
              <span className="font-medium">匯出 Excel</span>
            </button>

            {/* 重新載入 */}
            <button
              onClick={loadData}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              <RefreshCw size={20} />
              <span className="font-medium">重新載入</span>
            </button>
          </div>

          {/* 搜尋與篩選 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="搜尋職缺代碼、部門、職位、職系..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              {departments.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              {statuses.map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard title="總職缺數" value={jobs.length} color="bg-blue-500" />
          <StatCard title="需求人數" value={totalHeadcount} color="bg-purple-500" />
          <StatCard title="開啟中" value={jobs.filter(j => j.status === '開啟中').length} color="bg-green-500" />
          <StatCard title="招募中" value={jobs.filter(j => j.status === '招募中').length} color="bg-yellow-500" />
          <StatCard title="已關閉" value={jobs.filter(j => j.status === '關閉').length} color="bg-gray-500" />
        </div>

        {/* 職缺列表 */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-indigo-600 text-white">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">職缺代碼</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">HC所屬部門</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">職務名稱</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">工作地點</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">職系</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">需求人數</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">狀態</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-center text-gray-500">
                      <div className="flex flex-col items-center gap-3">
                        <Upload size={48} className="text-gray-300" />
                        <p className="text-lg font-medium">尚無職缺資料</p>
                        <p className="text-sm">請上傳 Excel 檔案或新增職缺</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 text-sm font-medium text-indigo-600">{job.jobId}</td>
                      <td className="px-4 py-4 text-sm text-gray-700">{job.department}</td>
                      <td className="px-4 py-4 text-sm text-gray-700 font-medium">{job.position}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{job.location || '-'}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">
                        {job.jobFamily ? (
                          <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                            {job.jobFamily}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 bg-indigo-100 text-indigo-700 rounded-full font-semibold text-sm">
                          {job.headcount}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          job.status === '開啟中' ? 'bg-green-100 text-green-800' :
                          job.status === '招募中' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setEditingJob(job)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="編輯"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteJob(job.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="刪除"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 顯示篩選結果數量 */}
        {filteredJobs.length > 0 && (
          <div className="mt-4 text-sm text-gray-600 text-center">
            顯示 {filteredJobs.length} 筆職缺，共需 {filteredJobs.reduce((sum, job) => sum + (Number(job.headcount) || 0), 0)} 人
          </div>
        )}
      </div>

      {/* 新增/編輯Modal */}
      {(showAddModal || editingJob) && (
        <JobModal
          job={editingJob}
          onSave={editingJob ? handleEditJob : handleAddJob}
          onClose={() => {
            setShowAddModal(false);
            setEditingJob(null);
          }}
        />
      )}
    </div>
  );
}

// 統計卡片組件
function StatCard({ title, value, color }) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-800">{value}</p>
        </div>
        <div className={`w-12 h-12 ${color} rounded-lg flex items-center justify-center text-white text-2xl font-bold`}>
          {value}
        </div>
      </div>
    </div>
  );
}

// 新增/編輯Modal組件
function JobModal({ job, onSave, onClose }) {
  const [formData, setFormData] = useState(job || {
    department: '',
    position: '',
    location: '',
    jobFamily: '',
    headcount: 1,
    approver: '',
    approvalDate: '',
    salaryRange: '',
    reason: '',
    status: '開啟中'
  });

  const handleSubmit = () => {
    if (!formData.department || !formData.position) {
      alert('請填寫必填欄位：HC所屬部門和職務名稱');
      return;
    }
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            {job ? '編輯職缺' : '新增職缺'}
          </h2>
          
          <div className="space-y-4">
            {/* 基本資訊區 */}
            <div className="border-b pb-4">
              <h3 className="text-lg font-semibold text-gray-700 mb-3">基本資訊</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    HC所屬部門 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => setFormData({...formData, department: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    placeholder="例: 資訊部"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    職務名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.position}
                    onChange={(e) => setFormData({...formData, position: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    placeholder="例: 軟體工程師"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">工作地點</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({...formData, location: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    placeholder="例: 台北、新竹"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">職系</label>
                  <input
                    type="text"
                    value={formData.jobFamily}
                    onChange={(e) => setFormData({...formData, jobFamily: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    placeholder="例: 技術、業務、管理"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">需求人數</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.headcount}
                    onChange={(e) => setFormData({...formData, headcount: parseInt(e.target.value) || 1})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">職缺狀態</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({...formData, status: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="開啟中">開啟中</option>
                    <option value="招募中">招募中</option>
                    <option value="關閉">關閉</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 核准資訊區 */}
            <div className="border-b pb-4">
              <h3 className="text-lg font-semibold text-gray-700 mb-3">核准資訊</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">核准人</label>
                  <input
                    type="text"
                    value={formData.approver}
                    onChange={(e) => setFormData({...formData, approver: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">核准日期</label>
                  <input
                    type="date"
                    value={formData.approvalDate}
                    onChange={(e) => setFormData({...formData, approvalDate: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">薪資範圍</label>
                  <input
                    type="text"
                    value={formData.salaryRange}
                    onChange={(e) => setFormData({...formData, salaryRange: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    placeholder="例: 50K-70K"
                  />
                </div>
              </div>
            </div>

            {/* 備註區 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">需求原因 / 備註</label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({...formData, reason: e.target.value})}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                rows="3"
                placeholder="請說明人力需求原因..."
              />
            </div>

            {/* 按鈕區 */}
            <div className="flex gap-4 pt-4">
              <button
                onClick={handleSubmit}
                className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors"
              >
                {job ? '儲存變更' : '新增職缺'}
              </button>
              <button
                onClick={onClose}
                className="flex-1 px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 font-medium transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}