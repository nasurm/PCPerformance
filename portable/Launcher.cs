using System;
using System.IO;
using System.Diagnostics;
using System.Threading;
using System.Net;
using System.Text;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Windows.Forms;

class Launcher {
 static JavaScriptSerializer json=new JavaScriptSerializer();
 static bool quiet=Environment.GetEnvironmentVariable("RADAR_NO_BROWSER")=="1";
 static Dictionary<string,object> Read(string file){return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));}
 static bool Ready(string file,string expected,out string address){
  address=null;
  try {
   var info=Read(file); if(expected!=null&&(string)info["instance"]!=expected)return false;
   int port=Convert.ToInt32(info["port"]);if(port<1||port>65535)return false;
   string url="http://127.0.0.1:"+port;
   var req=(HttpWebRequest)WebRequest.Create(url+"/api/health");req.Proxy=null;req.Timeout=800;
   using(var res=req.GetResponse())using(var reader=new StreamReader(res.GetResponseStream())){
    var health=json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
    if((string)health["instance"]!=(string)info["instance"])return false;
   }
   address=url;return true;
  }catch{return false;}
 }
 static void Open(string url){if(!quiet)Process.Start(new ProcessStartInfo(url){UseShellExecute=true});}
 [STAThread] static int Main(){
  Process child=null;
  try {
   string root=AppDomain.CurrentDomain.BaseDirectory;
   string hash;using(var sha=SHA256.Create()){hash=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-","").Substring(0,20);}
   string data=Path.Combine(root,"data");
   try{Directory.CreateDirectory(data);string probe=Path.Combine(data,Guid.NewGuid()+".tmp");File.WriteAllText(probe,"");File.Delete(probe);}
   catch{data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"PC Radar",hash);Directory.CreateDirectory(data);}
   string session=Path.Combine(data,"runtime.json");
   using(var mutex=new Mutex(false,"Local\\PCRadar-"+hash)){
    bool owner=false;try{owner=mutex.WaitOne(0);}catch(AbandonedMutexException){owner=true;}
    if(!owner){string address;for(int i=0;i<100;i++){if(Ready(session,null,out address)){Open(address);return 0;}Thread.Sleep(200);}throw new Exception("PC Radar is starting or shutting down. Please try again shortly.");}
    try{
     string instance=Guid.NewGuid().ToString("N");
     int port=0;try{port=Convert.ToInt32(Read(session)["port"]);}catch{}
     var start=new ProcessStartInfo(Path.Combine(root,"runtime","node.exe"),"\""+Path.Combine(root,"app","server.js")+"\"");
     start.WorkingDirectory=root;start.UseShellExecute=false;start.CreateNoWindow=true;
     start.EnvironmentVariables["RADAR_PORTABLE"]="1";
     start.EnvironmentVariables["RADAR_DATA_DIR"]=data;
     start.EnvironmentVariables["RADAR_INSTANCE"]=instance;
     start.EnvironmentVariables["PORT"]=port.ToString();
     // Do not inherit development hooks into the bundled runtime.
     start.EnvironmentVariables.Remove("NODE_OPTIONS");start.EnvironmentVariables.Remove("NODE_PATH");
     child=Process.Start(start);
     string address=null;bool ready=false;
     for(int i=0;i<150&&!child.HasExited;i++){if(Ready(session,instance,out address)){ready=true;break;}Thread.Sleep(200);}
     if(!ready)throw new Exception("PC Radar could not start. Extract the entire ZIP to a writable folder and try again.");
     Open(address);child.WaitForExit();return child.ExitCode;
    }finally{if(child!=null&&!child.HasExited)child.Kill();mutex.ReleaseMutex();}
   }
  }catch(Exception e){if(!quiet)MessageBox.Show(e.Message,"PC Radar",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
 }
}
