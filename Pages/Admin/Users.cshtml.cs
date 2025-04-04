// Pages/Admin/Users.cshtml.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using System.ComponentModel.DataAnnotations;
using TikTokHelper_Electron.Models;

namespace TikTokHelper_Electron.Pages.Admin
{
    [Authorize(Roles = "Administrator")] // Защищаем доступ
    public class UsersModel : PageModel
    {
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly IPasswordHasher<ApplicationUser> _passwordHasher;

        public IList<ApplicationUser> Users { get; set; } = new List<ApplicationUser>();

        [BindProperty]
        public UserInputModel Input { get; set; } = new();

        [TempData]
        public string StatusMessage { get; set; } = string.Empty;

        public UsersModel(UserManager<ApplicationUser> userManager, IPasswordHasher<ApplicationUser> passwordHasher)
        {
            _userManager = userManager;
            _passwordHasher = passwordHasher;
        }

        public async Task OnGetAsync()
        {
            Users = await _userManager.GetUsersInRoleAsync("Administrator");
            if (Users.Count == 0)
            {
                // Если нет пользователей в роли, показываем всех пользователей
                Users = _userManager.Users.ToList();
            }
        }

        public async Task<IActionResult> OnPostCreateAsync()
        {
            if (!ModelState.IsValid)
            {
                await OnGetAsync();
                return Page();
            }

            // Проверка на существующего пользователя
            var existingUser = await _userManager.FindByEmailAsync(Input.Email);
            if (existingUser != null)
            {
                ModelState.AddModelError(string.Empty, "Пользователь с таким email уже существует.");
                await OnGetAsync();
                return Page();
            }

            // Создание нового пользователя
            var user = new ApplicationUser
            {
                UserName = Input.Email,
                Email = Input.Email,
                EmailConfirmed = true // Автоматически подтверждаем email
            };

            var result = await _userManager.CreateAsync(user, Input.Password);
            if (result.Succeeded)
            {
                // Если мы хотим добавить его в роль администратора
                if (Input.IsAdmin)
                {
                    await _userManager.AddToRoleAsync(user, "Administrator");
                }

                StatusMessage = $"Пользователь {Input.Email} успешно создан.";
                return RedirectToPage();
            }

            foreach (var error in result.Errors)
            {
                ModelState.AddModelError(string.Empty, error.Description);
            }

            await OnGetAsync();
            return Page();
        }

        public async Task<IActionResult> OnPostDeleteAsync(string id)
        {
            var user = await _userManager.FindByIdAsync(id);
            if (user == null)
            {
                StatusMessage = "Пользователь не найден.";
                return RedirectToPage();
            }

            // Проверка, не удаляем ли мы последнего администратора
            var admins = await _userManager.GetUsersInRoleAsync("Administrator");
            if (admins.Count == 1 && admins[0].Id == id)
            {
                StatusMessage = "Нельзя удалить единственного администратора.";
                return RedirectToPage();
            }

            var result = await _userManager.DeleteAsync(user);
            if (result.Succeeded)
            {
                StatusMessage = $"Пользователь {user.Email} успешно удален.";
            }
            else
            {
                StatusMessage = $"Ошибка при удалении пользователя: {string.Join(", ", result.Errors.Select(e => e.Description))}";
            }

            return RedirectToPage();
        }
    }

    public class UserInputModel
    {
        [Required]
        [EmailAddress]
        [Display(Name = "Email")]
        public string Email { get; set; } = string.Empty;

        [Required]
        [StringLength(100, ErrorMessage = "Пароль должен быть не менее {2} и не более {1} символов.", MinimumLength = 6)]
        [DataType(DataType.Password)]
        [Display(Name = "Пароль")]
        public string Password { get; set; } = string.Empty;

        [Display(Name = "Администратор")]
        public bool IsAdmin { get; set; }
    }
}
