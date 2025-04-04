using Microsoft.AspNetCore.Mvc;
using System.Collections.Concurrent;

namespace TikTokHelper_Electron.Controllers
{
    [ApiController]
    [Route("api/server/[controller]")]
    public class SoundMappingsController : ControllerBase
    {
        // В данном примере используется потокобезопасный словарь для хранения маппинга
        private static readonly ConcurrentDictionary<string, string> _mappingStore
            = new ConcurrentDictionary<string, string>();

        // GET: /api/server/soundmappings
        [HttpGet]
        public IActionResult Get()
        {
            // Возвращаем все привязки как JSON
            return Ok(_mappingStore);
        }

        // POST: /api/server/soundmappings
        // Ожидается, что в теле запроса передается JSON-словарь, например: { "giftId1": "sound1", "giftId2": "sound2", ... }
        [HttpPost]
        public IActionResult Post([FromBody] Dictionary<string, string> mapping)
        {
            if (mapping == null)
            {
                return BadRequest("Некорректные данные");
            }

            // Обновляем все значения в хранилище
            foreach (var kvp in mapping)
            {
                _mappingStore.AddOrUpdate(kvp.Key, kvp.Value, (key, oldValue) => kvp.Value);
            }

            return Ok(new { message = "Привязки сохранены", mapping = _mappingStore });
        }
    }
}
