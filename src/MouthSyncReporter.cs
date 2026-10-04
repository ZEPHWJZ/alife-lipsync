using System;
using System.Globalization;
using System.IO;

namespace Alife.Function.Speech;

public static class MouthSyncReporter
{
    public static readonly string Dir = Path.Combine(Path.GetTempPath(), "Alife.Client");
    public static readonly string EnvelopePath = Path.Combine(Dir, "pet_mouth.bin");
    public static readonly string StartTickPath = Path.Combine(Dir, "pet_mouth_start.txt");

    public static void PublishEnvelope(float[] envelope, int windowMs)
    {
        try
        {
            Directory.CreateDirectory(Dir);
            using (var fs = File.Create(EnvelopePath))
            using (var bw = new BinaryWriter(fs))
            {
                bw.Write(windowMs);
                bw.Write(envelope.Length);
                foreach (var v in envelope) bw.Write(v);
            }
        }
        catch { }
    }

    // 播放器真正启动后再盖时间戳，作为前端对齐的起跑线
    public static void WriteStartTick()
    {
        try
        {
            File.WriteAllText(StartTickPath, DateTimeOffset.Now.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture));
        }
        catch { }
    }

    public static void Publish(float[] envelope, int windowMs)
    {
        PublishEnvelope(envelope, windowMs);
        WriteStartTick();
    }

    public static void Reset()
    {
        try
        {
            if (File.Exists(StartTickPath)) File.Delete(StartTickPath);
        }
        catch { }
    }
}
